// 文件: examples/118-02-ice-trickle.ts
// ICE 候选与 trickle：远端描述未就绪时缓冲、去重、end-of-candidates 收口与连通性检查
// 目标：乱序/提前到达的候选不丢不重，host 优先于 relay，ICE restart 后能重新接收候选

import assert from 'node:assert';

type CandidateType = 'host' | 'srflx' | 'prflx' | 'relay';

interface IceCandidate {
    foundation: string;
    component: 1 | 2;
    type: CandidateType;
    protocol: 'udp' | 'tcp';
    address: string;
    port: number;
}

/** RFC 8445 类型优先级：host > srflx/prflx > relay */
const TYPE_PREFERENCE: Record<CandidateType, number> = {
    host: 126,
    prflx: 110,
    srflx: 110,
    relay: 0,
};

function candidateKey(c: IceCandidate): string {
    return `${c.foundation}/${c.component}/${c.protocol}/${c.address}:${c.port}`;
}

/** priority = 2^24 × typePref + 2^8 × localPref + (256 - component) */
function candidatePriority(c: IceCandidate, localPreference = 65535): number {
    return TYPE_PREFERENCE[c.type] * 2 ** 24 + localPreference * 2 ** 8 + (256 - c.component);
}

type AddResult = 'buffered' | 'applied' | 'duplicate' | 'rejected';

/**
 * trickle 候选接收器。
 * 核心约束：addIceCandidate 必须在 setRemoteDescription 之后才能调用，
 * 早到的候选只能进缓冲区；end-of-candidates 早到时也要排队，不能直接丢弃。
 */
class TrickleIceAgent {
    private remoteDescriptionSet = false;
    private endQueued = false;
    private closed = false;
    private buffer: IceCandidate[] = [];
    private seen = new Set<string>();
    private generation = 0;
    readonly applied: IceCandidate[] = [];
    readonly log: string[] = [];

    get pending(): number {
        return this.buffer.length;
    }

    addRemoteCandidate(candidate: IceCandidate): AddResult {
        if (this.closed || this.endQueued) {
            this.log.push('reject after end');
            return 'rejected';
        }
        const key = `${this.generation}|${candidateKey(candidate)}`;
        if (this.seen.has(key)) {
            this.log.push('duplicate');
            return 'duplicate';
        }
        this.seen.add(key);
        if (!this.remoteDescriptionSet) {
            this.buffer.push(candidate);
            this.log.push('buffered');
            return 'buffered';
        }
        this.applied.push(candidate);
        this.log.push('applied');
        return 'applied';
    }

    /** 远端描述就绪：按到达顺序冲刷缓冲区；若结束标记已排队，则立即收口 */
    setRemoteDescription(): number {
        this.remoteDescriptionSet = true;
        const count = this.buffer.length;
        this.applied.push(...this.buffer);
        this.buffer = [];
        this.log.push(`flush ${count}`);
        if (this.endQueued) this.closeCandidateStream();
        return count;
    }

    endOfCandidates(): void {
        this.endQueued = true;
        if (this.remoteDescriptionSet) this.closeCandidateStream();
    }

    private closeCandidateStream(): void {
        this.closed = true;
        this.endQueued = false;
        this.log.push('end-of-candidates');
    }

    /** ICE restart：新 ufrag 会重发同一批候选，必须换代号并清空去重集合 */
    restart(): void {
        this.generation += 1;
        this.remoteDescriptionSet = false;
        this.endQueued = false;
        this.closed = false;
        this.buffer = [];
        this.seen.clear();
        this.log.push(`restart gen=${this.generation}`);
    }
}

interface CandidatePair {
    local: IceCandidate;
    remote: IceCandidate;
    succeeded: boolean;
}

/** 按 RFC 8445 的 pair priority 排序：先比 min，再比 max；只选连通成功的对 */
function selectPair(pairs: CandidatePair[]): CandidatePair | null {
    const succeeded = pairs.filter((pair) => pair.succeeded);
    succeeded.sort((a, b) => {
        const minA = Math.min(candidatePriority(a.local), candidatePriority(a.remote));
        const minB = Math.min(candidatePriority(b.local), candidatePriority(b.remote));
        if (minA !== minB) return minB - minA;
        return Math.max(candidatePriority(b.local), candidatePriority(b.remote))
            - Math.max(candidatePriority(a.local), candidatePriority(a.remote));
    });
    return succeeded[0] ?? null;
}

const host: IceCandidate = {
    foundation: 'h1', component: 1, type: 'host', protocol: 'udp', address: '192.168.1.8', port: 54321,
};
const srflx: IceCandidate = {
    foundation: 's1', component: 1, type: 'srflx', protocol: 'udp', address: '203.0.113.7', port: 54321,
};
const relay: IceCandidate = {
    foundation: 'r1', component: 1, type: 'relay', protocol: 'udp', address: '198.51.100.9', port: 3478,
};

function runAssertions() {
    // ---------- 测试 1：远端描述未就绪时全部缓冲，就绪后保序冲刷 ----------
    const agent = new TrickleIceAgent();
    assert.equal(agent.addRemoteCandidate(host), 'buffered');
    assert.equal(agent.addRemoteCandidate(srflx), 'buffered');
    assert.equal(agent.addRemoteCandidate(relay), 'buffered');
    assert.equal(agent.pending, 3);
    assert.equal(agent.applied.length, 0);
    assert.equal(agent.setRemoteDescription(), 3);
    assert.deepEqual(agent.applied.map((c) => c.type), ['host', 'srflx', 'relay'], '必须按到达顺序应用');
    assert.equal(agent.pending, 0);
    console.log('[1/4] 候选缓冲 OK, flush:', agent.applied.length);

    // ---------- 测试 2：去重 + end-of-candidates 收口（含提前到达） ----------
    const a2 = new TrickleIceAgent();
    a2.setRemoteDescription();
    assert.equal(a2.addRemoteCandidate(host), 'applied');
    assert.equal(a2.addRemoteCandidate(host), 'duplicate', '同一候选重复推送必须去重');
    assert.equal(a2.applied.length, 1);
    a2.endOfCandidates();
    assert.equal(a2.addRemoteCandidate(srflx), 'rejected', '结束标记之后不得再收候选');

    const a3 = new TrickleIceAgent();
    assert.equal(a3.addRemoteCandidate(host), 'buffered');
    a3.endOfCandidates(); // 早于远端描述到达
    assert.equal(a3.addRemoteCandidate(srflx), 'rejected', '结束标记先到，后续候选一律拒绝');
    assert.equal(a3.setRemoteDescription(), 1, '缓冲区里已有的候选仍要应用');
    assert.deepEqual(a3.applied.map((c) => c.type), ['host']);
    console.log('[2/4] 去重与收口 OK, a2.applied:', a2.applied.length, 'a3.applied:', a3.applied.length);

    // ---------- 测试 3：连通性检查——优先级与成功对选择 ----------
    assert.ok(candidatePriority(host) > candidatePriority(srflx), 'host 必须优先于 srflx');
    assert.ok(candidatePriority(srflx) > candidatePriority(relay), '直连必须优先于 relay');
    assert.equal(candidatePriority(srflx), candidatePriority({ ...srflx, type: 'prflx' }), 'srflx/prflx 同级');

    const hostPair: CandidatePair = { local: host, remote: host, succeeded: true };
    const relayPair: CandidatePair = { local: host, remote: relay, succeeded: true };
    assert.equal(selectPair([relayPair, hostPair]), hostPair, 'host 对连通成功时优先选 host');
    assert.equal(selectPair([relayPair]), relayPair, '只有 relay 成功时只能走中转');
    assert.equal(selectPair([{ ...hostPair, succeeded: false }]), null, '没有成功对时返回 null');
    console.log('[3/4] 连通性检查 OK, host/relay 优先级:', candidatePriority(host), '/', candidatePriority(relay));

    // ---------- 测试 4：ICE restart——代号切换后候选可重新接收 ----------
    const a4 = new TrickleIceAgent();
    a4.setRemoteDescription();
    a4.addRemoteCandidate(host);
    a4.endOfCandidates();
    assert.equal(a4.addRemoteCandidate(srflx), 'rejected');
    a4.restart();
    assert.equal(a4.addRemoteCandidate(host), 'buffered', 'restart 后应重新进入缓冲（等新远端描述）');
    assert.equal(a4.setRemoteDescription(), 1);
    assert.equal(a4.addRemoteCandidate(host), 'duplicate', '新一轮内仍要防重');
    console.log('[4/4] ICE restart OK, applied:', a4.applied.length);

    console.log('\n✅ 118-02 ICE 候选与 trickle 全部断言通过');
}

runAssertions();
