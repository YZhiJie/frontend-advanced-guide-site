// 文件: examples/113-04-pwa-update-state-machine.ts
// PWA 更新状态机：idle / checking / available / activating，脏表单时禁止自动激活
// 目标：更新只在用户确认或表单已保存后生效，避免 controllerchange 强制刷新丢表单

import assert from 'node:assert';

type UpdateState = 'idle' | 'checking' | 'available' | 'activating';

type UpdateEvent =
    | 'CHECK'
    | 'FOUND'
    | 'NOT_FOUND'
    | 'CONFIRM'
    | 'APPLY'
    | 'DISCARD'
    | 'FORM_SAVED'
    | 'DISMISS'
    | 'ERROR';

interface Snapshot {
    state: UpdateState;
    version: string | null;
    hasUnsavedChanges: boolean;
    deferred: boolean;
}

class PwaUpdateMachine {
    state: UpdateState = 'idle';
    version: string | null = null;
    hasUnsavedChanges = false;
    deferred = false; // 曾因脏表单推迟激活
    readonly history: string[] = [];

    get snapshot(): Snapshot {
        return {
            state: this.state,
            version: this.version,
            hasUnsavedChanges: this.hasUnsavedChanges,
            deferred: this.deferred,
        };
    }

    send(event: UpdateEvent, payload: { version?: string } = {}): boolean {
        this.history.push(event);
        switch (event) {
            case 'CHECK':
                if (this.state !== 'idle') return this.reject();
                this.state = 'checking';
                return true;
            case 'FOUND':
                if (this.state !== 'checking') return this.reject();
                this.version = payload.version ?? 'unknown';
                this.state = 'available';
                return true;
            case 'NOT_FOUND':
                if (this.state !== 'checking') return this.reject();
                this.state = 'idle';
                return true;
            case 'APPLY': // SW 的 controllerchange 自动触发
            case 'CONFIRM': // 用户点了「立即更新」
                if (this.state !== 'available') return this.reject();
                if (this.hasUnsavedChanges) {
                    this.deferred = true;
                    this.reject();
                    return false; // 关键：不进入 activating，页面不刷新
                }
                this.state = 'activating';
                return true;
            case 'DISCARD': // 用户明确放弃未保存内容
                if (this.state !== 'available') return this.reject();
                this.hasUnsavedChanges = false;
                this.state = 'activating';
                return true;
            case 'FORM_SAVED': // 用户保存后，此前推迟的更新自动继续
                if (this.state !== 'available' || !this.deferred) return this.reject();
                this.hasUnsavedChanges = false;
                this.deferred = false;
                this.state = 'activating';
                return true;
            case 'DISMISS': // 本次不更新，下次启动再检查
                if (this.state !== 'available') return this.reject();
                this.state = 'idle';
                this.version = null;
                this.deferred = false;
                return true;
            case 'ERROR': // 激活失败回滚到 available，允许重试
                if (this.state !== 'checking' && this.state !== 'activating') return this.reject();
                this.state = this.version ? 'available' : 'idle';
                return true;
        }
    }

    /** 非法事件既不改状态也不留在轨迹里，方便线上排查真实迁移 */
    private reject(): false {
        this.history.pop();
        return false;
    }
}

function runAssertions() {
    // ---------- 测试 1：干净页面走完整更新流程 ----------
    const clean = new PwaUpdateMachine();
    assert.equal(clean.send('CHECK'), true);
    assert.equal(clean.state, 'checking');
    assert.equal(clean.send('FOUND', { version: 'v3.2.1' }), true);
    assert.equal(clean.state, 'available');
    assert.equal(clean.version, 'v3.2.1');
    assert.deepEqual(clean.snapshot, {
        state: 'available',
        version: 'v3.2.1',
        hasUnsavedChanges: false,
        deferred: false,
    });
    assert.equal(clean.send('CONFIRM'), true);
    assert.equal(clean.state, 'activating');
    assert.deepEqual(clean.history, ['CHECK', 'FOUND', 'CONFIRM']);
    console.log('[1/4] 干净页面更新流程 OK');

    // ---------- 测试 2：脏表单拦截 SW 自动激活 ----------
    const dirty = new PwaUpdateMachine();
    dirty.send('CHECK');
    dirty.send('FOUND', { version: 'v4.0.0' });
    dirty.hasUnsavedChanges = true;
    assert.equal(dirty.send('APPLY'), false, 'controllerchange 不得强制刷新');
    assert.equal(dirty.state, 'available', '状态必须停在 available');
    assert.equal(dirty.deferred, true);
    assert.equal(dirty.send('CONFIRM'), false, '用户点击也不能丢表单');
    assert.equal(dirty.state, 'available');
    assert.equal(dirty.hasUnsavedChanges, true);
    assert.equal(dirty.history.includes('APPLY'), false, '被拒事件不写入轨迹');
    console.log('[2/4] 脏表单拦截 OK');

    // ---------- 测试 3：用户放弃修改 / 先保存再更新 ----------
    assert.equal(dirty.send('DISCARD'), true);
    assert.equal(dirty.state, 'activating');
    assert.equal(dirty.hasUnsavedChanges, false);

    const saveFirst = new PwaUpdateMachine();
    saveFirst.send('CHECK');
    saveFirst.send('FOUND', { version: 'v4.1.0' });
    saveFirst.hasUnsavedChanges = true;
    assert.equal(saveFirst.send('APPLY'), false);
    assert.equal(saveFirst.deferred, true);
    saveFirst.hasUnsavedChanges = false; // 表单保存成功
    assert.equal(saveFirst.send('FORM_SAVED'), true, '保存后自动继续更新');
    assert.equal(saveFirst.state, 'activating');
    assert.equal(saveFirst.deferred, false);
    console.log('[3/4] 放弃修改与保存后更新 OK');

    // ---------- 测试 4：非法事件、忽略更新与失败回滚 ----------
    const guard = new PwaUpdateMachine();
    assert.equal(guard.send('CONFIRM'), false, 'idle 不能直接确认');
    assert.equal(guard.state, 'idle');
    assert.deepEqual(guard.history, []);

    guard.send('CHECK');
    guard.send('FOUND', { version: 'v5.0.0' });
    assert.equal(guard.send('DISMISS'), true);
    assert.equal(guard.state, 'idle');
    assert.equal(guard.version, null);

    guard.send('CHECK');
    guard.send('FOUND', { version: 'v5.0.0' });
    guard.send('CONFIRM');
    assert.equal(guard.state, 'activating');
    assert.equal(guard.send('ERROR'), true);
    assert.equal(guard.state, 'available', '激活失败应回滚以便重试');

    const network = new PwaUpdateMachine();
    network.send('CHECK');
    assert.equal(network.send('ERROR'), true);
    assert.equal(network.state, 'idle', '检查失败回到 idle');
    assert.equal(network.send('CHECK'), true, '失败后可以重新检查');
    console.log('[4/4] 非法事件与失败回滚 OK');

    console.log('\n✅ 113-04 PWA 更新状态机 全部断言通过');
}

runAssertions();
