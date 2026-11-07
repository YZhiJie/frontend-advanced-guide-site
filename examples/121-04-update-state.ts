// 文件: examples/121-04-update-state.ts
// Electron 自动更新状态机：checking / available / downloading / ready / error 与失败回滚
// 目标：非法迁移拒绝、下载失败清空半成品并回到可重试状态、校验失败不得进入 ready

import assert from 'node:assert';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

type UpdateErrorCode = 'E_NETWORK' | 'E_CHECKSUM';

interface ReleaseInfo {
    version: string;
    url: string;
    sizeBytes: number;
    sha256: string;
}

type ProgressHandler = (receivedBytes: number) => void;

interface DownloadedArtifact {
    path: string;
    sha256: string;
}

interface Downloader {
    download(info: ReleaseInfo, onProgress: ProgressHandler): Promise<DownloadedArtifact>;
}

class AppUpdater {
    state: UpdateState = 'idle';
    release: ReleaseInfo | null = null;
    progress = 0;
    stagedPath: string | null = null;
    errorCode: UpdateErrorCode | null = null;
    installed = false;

    constructor(private readonly downloader: Downloader) {}

    /** 检查更新：进入 checking，有版本则 available，无版本回到 idle */
    async check(fetchRelease: () => Promise<ReleaseInfo | null>): Promise<void> {
        this.requireState('idle', 'check');
        this.state = 'checking';
        const next = await fetchRelease();
        if (next) {
            this.release = next;
            this.state = 'available';
        } else {
            this.release = null;
            this.state = 'idle';
        }
    }

    /** 下载并校验：只有 sha256 与清单一致才允许进入 ready */
    async download(): Promise<void> {
        this.requireState('available', 'download');
        const release = this.release;
        if (release === null) throw new Error('E_ILLEGAL_TRANSITION: release 为空');

        this.state = 'downloading';
        this.progress = 0;

        try {
            const artifact = await this.downloader.download(release, (receivedBytes) => {
                this.progress = Math.min(100, Math.round((receivedBytes / release.sizeBytes) * 100));
            });
            if (artifact.sha256 !== release.sha256) throw new Error('E_CHECKSUM');
            this.stagedPath = artifact.path;
            this.progress = 100;
            this.state = 'ready';
        } catch (error) {
            const code: UpdateErrorCode = error instanceof Error && error.message === 'E_CHECKSUM' ? 'E_CHECKSUM' : 'E_NETWORK';
            this.rollback(code);
            throw error;
        }
    }

    /** 失败回滚：删除半成品引用、进度归零，并保留错误码供 UI 展示 */
    private rollback(code: UpdateErrorCode): void {
        this.stagedPath = null;
        this.progress = 0;
        this.errorCode = code;
        this.state = 'error';
    }

    /** 重试只负责把 error 退回 available，真正的下载由调用方再次发起 */
    retry(): void {
        this.requireState('error', 'retry');
        this.errorCode = null;
        this.state = 'available';
    }

    /** 安装只能从 ready 触发，等价于 quitAndInstall 的前置守卫 */
    install(): void {
        this.requireState('ready', 'install');
        this.installed = true;
    }

    private requireState(expected: UpdateState, action: string): void {
        if (this.state !== expected) {
            throw new Error(`E_ILLEGAL_TRANSITION: ${action} 需要 ${expected}，当前 ${this.state}`);
        }
    }
}

type Outcome = 'ok' | 'network' | 'corrupt';

/** 可编排结果的假下载器：按顺序消费 outcome，便于测试失败重试 */
class FakeDownloader implements Downloader {
    calls = 0;

    constructor(private readonly outcomes: Outcome[]) {}

    async download(info: ReleaseInfo, onProgress: ProgressHandler): Promise<DownloadedArtifact> {
        const outcome = this.outcomes[this.calls] ?? 'ok';
        this.calls += 1;

        if (outcome === 'network') {
            onProgress(Math.floor(info.sizeBytes * 0.3));
            throw new Error('E_NETWORK');
        }

        if (outcome === 'corrupt') {
            onProgress(info.sizeBytes);
            return { path: `/tmp/${info.version}.part`, sha256: 'bad-checksum' };
        }

        onProgress(Math.floor(info.sizeBytes * 0.5));
        onProgress(info.sizeBytes);
        return { path: `/tmp/update-${info.version}.zip`, sha256: info.sha256 };
    }
}

const RELEASE: ReleaseInfo = {
    version: '2.4.0',
    url: 'https://updates.shop.example.com/2.4.0.zip',
    sizeBytes: 8000,
    sha256: 'sha256-2.4.0',
};

async function runAssertions(): Promise<void> {
    // ---------- 测试 1：完整链路 idle → checking → available → downloading → ready ----------
    const updater = new AppUpdater(new FakeDownloader(['ok']));
    const checking = updater.check(async () => RELEASE);
    assert.equal(updater.state, 'checking', '请求发出后应立刻进入 checking');
    await checking;
    assert.equal(updater.state, 'available');
    assert.deepEqual(updater.release, RELEASE);

    await updater.download();
    assert.equal(updater.state, 'ready');
    assert.equal(updater.progress, 100);
    assert.equal(updater.stagedPath, '/tmp/update-2.4.0.zip');

    updater.install();
    assert.equal(updater.installed, true);
    console.log('[1/4] 完整链路 OK, checking → ready, 进度 100');

    // ---------- 测试 2：无更新与非法迁移 ----------
    const noUpdate = new AppUpdater(new FakeDownloader([]));
    await noUpdate.check(async () => null);
    assert.equal(noUpdate.state, 'idle', '无新版本应回到 idle');
    assert.equal(noUpdate.release, null);
    await assert.rejects(() => noUpdate.download(), /E_ILLEGAL_TRANSITION/, 'idle 不能直接下载');

    const fresh = new AppUpdater(new FakeDownloader(['ok']));
    await fresh.check(async () => RELEASE);
    assert.throws(() => fresh.install(), /E_ILLEGAL_TRANSITION/, 'available 不能直接安装');
    assert.throws(() => fresh.retry(), /E_ILLEGAL_TRANSITION/, 'available 不能重试');
    console.log('[2/4] 非法迁移 OK, idle/available 越级操作被拒绝');

    // ---------- 测试 3：下载失败回滚并可从零重试 ----------
    const downloader = new FakeDownloader(['network', 'ok']);
    const flaky = new AppUpdater(downloader);
    await flaky.check(async () => RELEASE);
    await assert.rejects(() => flaky.download(), /E_NETWORK/);
    assert.equal(flaky.state, 'error');
    assert.equal(flaky.errorCode, 'E_NETWORK');
    assert.equal(flaky.stagedPath, null, '失败必须清理半成品引用');
    assert.equal(flaky.progress, 0, '进度必须归零');

    flaky.retry();
    assert.equal(flaky.state, 'available');
    assert.equal(flaky.errorCode, null);
    await flaky.download();
    assert.equal(flaky.state, 'ready');
    assert.equal(flaky.progress, 100);
    assert.equal(downloader.calls, 2, '重试应重新下载而不是复用半成品');
    console.log('[3/4] 失败回滚 OK, 半成品清理后重试成功');

    // ---------- 测试 4：校验失败——坏包不得进入 ready，回滚后可重试 ----------
    const corrupt = new AppUpdater(new FakeDownloader(['corrupt']));
    await corrupt.check(async () => RELEASE);
    await assert.rejects(() => corrupt.download(), /E_CHECKSUM/);
    assert.equal(corrupt.state, 'error');
    assert.equal(corrupt.errorCode, 'E_CHECKSUM');
    assert.equal(corrupt.stagedPath, null, '校验失败不得保留坏包');
    assert.equal(corrupt.progress, 0);
    assert.throws(() => corrupt.install(), /E_ILLEGAL_TRANSITION/, 'error 状态禁止安装');

    corrupt.retry();
    assert.equal(corrupt.state, 'available');
    console.log('[4/4] 校验失败 OK, 坏包回滚且禁止安装');

    console.log('\n✅ 121-04 自动更新状态机 全部断言通过');
}

runAssertions();
