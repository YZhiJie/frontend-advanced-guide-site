// 文件: examples/115-02-timezone-booking.ts
// 时区预约：用户时区 / 商家时区、DST 跨越、可用时段计算
// 目标：墙上时间不能直接 Date.UTC；春季缺口跳过、秋季重叠取较早一次、两端展示可互换

import assert from 'node:assert';

interface WallClock {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
}

interface Slot {
    start: number;
    end: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
    const cached = formatterCache.get(timeZone);
    if (cached) return cached;
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
    return formatter;
}

/** 某个瞬时在目标时区的墙上时间（秒级，避免毫秒误差） */
function wallClockAt(instant: number, timeZone: string): WallClock & { second: number } {
    const parts = formatterFor(timeZone).formatToParts(new Date(instant));
    const read = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
    return {
        year: read('year'),
        month: read('month'),
        day: read('day'),
        hour: read('hour'),
        minute: read('minute'),
        second: read('second'),
    };
}

/** 目标时区在某个瞬时的 UTC 偏移（毫秒），例如纽约冬季 -5h、夏季 -4h */
function offsetMs(instant: number, timeZone: string): number {
    const aligned = Math.floor(instant / 1000) * 1000;
    const wall = wallClockAt(aligned, timeZone);
    const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    return asUtc - aligned;
}

/** 解析墙上时间 → UTC 瞬时；返回 null 表示落在 DST 缺口的“不存在的钟点” */
function resolveWallTime(wall: WallClock, timeZone: string): { instant: number; ambiguous: boolean } | null {
    const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
    // 取前后 48h 的偏移作为候选：DST 切换前后分别对应两个不同偏移
    const candidateOffsets = new Set([
        offsetMs(guess - 48 * 3600_000, timeZone),
        offsetMs(guess, timeZone),
        offsetMs(guess + 48 * 3600_000, timeZone),
    ]);
    const valid: number[] = [];
    for (const offset of candidateOffsets) {
        const candidate = guess - offset;
        const back = wallClockAt(candidate, timeZone);
        const sameWall =
            back.year === wall.year &&
            back.month === wall.month &&
            back.day === wall.day &&
            back.hour === wall.hour &&
            back.minute === wall.minute;
        if (sameWall) valid.push(candidate);
    }
    if (valid.length === 0) return null;
    valid.sort((a, b) => a - b);
    return { instant: valid[0], ambiguous: valid.length > 1 };
}

function timeLabel(instant: number, timeZone: string): string {
    const wall = wallClockAt(instant, timeZone);
    return `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`;
}

interface BookingOptions {
    timeZone: string;
    date: string; // YYYY-MM-DD（商家时区的营业日期）
    openMinute: number; // 当地 09:00 = 540
    closeMinute: number;
    durationMinute: number;
    now: number;
}

/** 商家当地营业日生成可预约时段：跳过 DST 缺口、去重同一瞬时、过滤已过期 */
function generateSlots(options: BookingOptions): Slot[] {
    const [year, month, day] = options.date.split('-').map(Number);
    const slots: Slot[] = [];
    const seen = new Set<number>();
    for (let minute = options.openMinute; minute + options.durationMinute <= options.closeMinute; minute += options.durationMinute) {
        const wall: WallClock = {
            year,
            month,
            day,
            hour: Math.floor(minute / 60),
            minute: minute % 60,
        };
        const resolved = resolveWallTime(wall, options.timeZone);
        if (!resolved || resolved.instant < options.now || seen.has(resolved.instant)) continue;
        seen.add(resolved.instant);
        slots.push({ start: resolved.instant, end: resolved.instant + options.durationMinute * 60_000 });
    }
    return slots.sort((a, b) => a.start - b.start);
}

function runAssertions() {
    // ---------- 测试 1：时区偏移随 DST 变化，必须按瞬时查，不能写死 ----------
    assert.equal(offsetMs(Date.UTC(2026, 0, 15, 12), 'America/New_York'), -5 * 3600_000, '纽约冬季 EST');
    assert.equal(offsetMs(Date.UTC(2026, 6, 15, 12), 'America/New_York'), -4 * 3600_000, '纽约夏季 EDT');
    assert.equal(offsetMs(Date.UTC(2026, 0, 15, 12), 'Asia/Shanghai'), 8 * 3600_000, '上海无夏令时');
    assert.equal(offsetMs(Date.UTC(2026, 0, 15, 12), 'Europe/London'), 0);
    assert.equal(offsetMs(Date.UTC(2026, 6, 15, 12), 'Europe/London'), 3600_000);
    console.log('[1/4] 时区偏移 OK, 纽约 1 月 -5h / 7 月 -4h');

    // ---------- 测试 2：夏令时缺口返回 null，重叠标记 ambiguous 并取较早瞬时 ----------
    const gap = resolveWallTime({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York');
    assert.equal(gap, null, '2026-03-08 02:30 纽约不存在');
    const normal = resolveWallTime({ year: 2026, month: 3, day: 8, hour: 9, minute: 0 }, 'America/New_York');
    assert.ok(normal);
    assert.equal(normal.instant, Date.UTC(2026, 2, 8, 13, 0), 'EDT 09:00 = 13:00Z');
    assert.equal(normal.ambiguous, false);
    const overlap = resolveWallTime({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, 'America/New_York');
    assert.ok(overlap);
    assert.equal(overlap.ambiguous, true, '秋季回拨 01:30 出现两次');
    assert.equal(overlap.instant, Date.UTC(2026, 10, 1, 5, 30), '取较早的 EDT 瞬时');
    assert.equal(timeLabel(overlap.instant, 'America/New_York'), '01:30');
    console.log('[2/4] DST 缺口/重叠 OK, 缺口 null, 重叠 instant=', new Date(overlap.instant).toISOString());

    // ---------- 测试 3：营业时段生成——春季缺口少一格、秋季不重复、时段不重叠 ----------
    const now = Date.UTC(2026, 2, 1);
    const spring = generateSlots({
        timeZone: 'America/New_York',
        date: '2026-03-08',
        openMinute: 60,
        closeMinute: 240,
        durationMinute: 60,
        now,
    });
    assert.deepEqual(spring.map((s) => timeLabel(s.start, 'America/New_York')), ['01:00', '03:00']);
    assert.equal(spring.length, 2, '02:00 被 DST 吃掉');
    for (let i = 1; i < spring.length; i++) assert.ok(spring[i].start >= spring[i - 1].end, '时段不得重叠');

    const autumn = generateSlots({
        timeZone: 'America/New_York',
        date: '2026-11-01',
        openMinute: 60,
        closeMinute: 180,
        durationMinute: 60,
        now: Date.UTC(2026, 9, 1),
    });
    assert.deepEqual(autumn.map((s) => timeLabel(s.start, 'America/New_York')), ['01:00', '02:00']);
    assert.equal(new Set(autumn.map((s) => s.start)).size, 2, '同一瞬时不得生成两个时段');
    console.log('[3/4] 营业时段 OK, 春季:', spring.map((s) => timeLabel(s.start, 'America/New_York')).join(','));

    // ---------- 测试 4：同一瞬时在用户时区/商家时区展示一致可逆 ----------
    const slotStart = Date.UTC(2026, 2, 8, 13, 0); // 纽约 09:00
    assert.equal(timeLabel(slotStart, 'America/New_York'), '09:00');
    assert.equal(timeLabel(slotStart, 'Europe/London'), '13:00', '3 月 8 日伦敦仍是 GMT');
    assert.equal(timeLabel(slotStart, 'Asia/Shanghai'), '21:00');
    assert.equal(timeLabel(slotStart, 'Asia/Tokyo'), '22:00');
    const userWall = wallClockAt(slotStart, 'Asia/Shanghai');
    const roundTrip = resolveWallTime(
        { year: userWall.year, month: userWall.month, day: userWall.day, hour: userWall.hour, minute: userWall.minute },
        'Asia/Shanghai',
    );
    assert.ok(roundTrip);
    assert.equal(roundTrip.instant, slotStart, '用户端提交的墙上时间应还原为同一瞬时');
    console.log('[4/4] 双时区展示 OK, 纽约 09:00 = 上海 21:00');

    console.log('\n✅ 115-02 时区预约与 DST 全部断言通过');
}

runAssertions();
