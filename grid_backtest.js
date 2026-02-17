/**
 * grid_backtest.js - 網格策略回測與參數優化
 *
 * 功能：
 *   1. 模擬網格機器人在歷史 K 線上的表現
 *   2. 自動尋找最佳 atrMultiplier × gridCount 組合
 *   3. 計算橫盤分數（越高越適合網格）
 *   4. 結果儲存至 backtest.db（strategy='GRID'）
 *
 * 使用方式：
 *   node grid_backtest.js                        # 測試預設幣種
 *   node grid_backtest.js PIPPIN/USDT:USDT       # 指定幣種
 *   node grid_backtest.js PIPPIN/USDT:USDT 60    # 指定幣種 + 回測天數
 */

import ccxt from 'ccxt';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ATR } from 'technicalindicators';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

// ===== 設定 =====
const TARGET_SYMBOL = process.argv[2] || 'PIPPIN/USDT:USDT';
const DAYS_BACK     = parseInt(process.argv[3]) || 90;

const CONFIG = {
    timeframe:    '1h',        // 1h K 線（更細的模擬精度）
    investment:   180,         // 模擬投入資金 (USDT)
    leverage:     1,           // 槓桿倍數
    feeRate:      0.0004,      // 手續費率（Taker 0.04%）
    atrPeriod:    14,          // ATR 週期
    maPeriod:     20,          // 橫盤判斷 MA 週期（4h）
    maThreshold:  0.03,        // 偏離 MA 超過 3% = 趨勢中（跳過）
    minCandles:   200,         // 最少需要的 K 線數

    // 優化參數範圍
    atrMultipliers: [0.5, 0.8, 1.0, 1.2, 1.5, 2.0],
    gridCounts:     [5, 8, 10, 15, 20],
};

const DB_PATH = path.join(__dirname, 'backtest.db');
const exchange = new ccxt.binance({ options: { defaultType: 'future' } });

// ===== DB 初始化 =====
function initDB() {
    const db = new Database(DB_PATH);
    // 確保 strategy 欄位存在（趨勢回測已建立此表）
    try { db.exec(`ALTER TABLE backtest_runs ADD COLUMN strategy TEXT NOT NULL DEFAULT 'EMA_CROSSOVER'`); } catch (_) {}
    db.exec(`
        CREATE TABLE IF NOT EXISTS backtest_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy TEXT NOT NULL DEFAULT 'EMA_CROSSOVER',
            run_at TEXT NOT NULL,
            symbol TEXT NOT NULL,
            timeframe TEXT NOT NULL,
            days_back INTEGER,
            ema_fast INTEGER,
            ema_slow INTEGER,
            atr_stop_mult REAL,
            atr_tp_mult REAL,
            leverage INTEGER,
            investment REAL,
            final_equity REAL,
            total_pnl REAL,
            total_pnl_pct REAL,
            max_drawdown REAL,
            trade_count INTEGER,
            win_count INTEGER,
            win_rate REAL,
            avg_win REAL,
            avg_loss REAL
        );
    `);
    return db;
}

// ===== 抓取歷史 K 線 =====
async function fetchOHLCV(symbol, timeframe, daysBack) {
    const since = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    let all = [];
    let from = since;
    while (true) {
        const d = await exchange.fetchOHLCV(symbol, timeframe, from, 1000);
        if (!d.length) break;
        all = all.concat(d);
        const last = d[d.length - 1][0];
        const tfMs = timeframe === '1h' ? 3600000 : timeframe === '4h' ? 14400000 : 3600000;
        if (last >= Date.now() - tfMs) break;
        from = last + 1;
        await new Promise(r => setTimeout(r, 150));
    }
    return all;
}

// ===== 計算 SMA =====
function calcSMA(values, period) {
    const result = new Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
        const slice = values.slice(i - period + 1, i + 1);
        result[i] = slice.reduce((a, b) => a + b, 0) / period;
    }
    return result;
}

// ===== 橫盤分數計算（用 4h K 線）=====
// 判斷某幣種有多少比例的時間在橫盤（適合跑網格）
function calcSidewaysScore(ohlcv4h, maPeriod, threshold) {
    if (!ohlcv4h || ohlcv4h.length < maPeriod + 1) return 0;
    const closes = ohlcv4h.map(c => c[4]);
    const sma = calcSMA(closes, maPeriod);
    let sidewaysCount = 0;
    let total = 0;
    for (let i = maPeriod; i < closes.length; i++) {
        if (sma[i] === null) continue;
        const deviation = Math.abs(closes[i] - sma[i]) / sma[i];
        if (deviation <= threshold) sidewaysCount++;
        total++;
    }
    return total > 0 ? (sidewaysCount / total * 100) : 0;
}

// ===== 核心：網格回測模擬 =====
//
// 模擬邏輯：
//  - 每根 1h K 線，用 high/low 判斷是否有網格被觸發
//  - 每次觸發的填單數 ≈ min(floor((high - low) / gridStep), gridCount - 1)
//  - 每個填單（一次 buy + 一次 sell 的往返）賺 gridStep 的利潤
//  - 若 high > upperPrice 或 low < lowerPrice → 破網重置
//  - 破網時：估算持倉虧損（方向性損失）
//
function runGridBacktest(ohlcv1h, atrMultiplier, gridCount) {
    const closes  = ohlcv1h.map(c => c[4]);
    const highs   = ohlcv1h.map(c => c[2]);
    const lows    = ohlcv1h.map(c => c[3]);

    const atrArr = ATR.calculate({
        period: CONFIG.atrPeriod,
        high: highs,
        low: lows,
        close: closes,
    });
    const offset = closes.length - atrArr.length;

    let equity     = CONFIG.investment;
    let peakEquity = CONFIG.investment;
    let maxDrawdown = 0;
    let totalFills  = 0;
    let totalResets = 0;
    let totalPnl    = 0;

    // 網格狀態
    let gridActive  = false;
    let upperPrice  = 0;
    let lowerPrice  = 0;
    let gridStep    = 0;

    // 初始化網格
    function resetGrid(price, atr) {
        gridStep   = atr * atrMultiplier;
        if (gridStep <= 0) return;
        upperPrice = price + (gridStep * gridCount / 2);
        lowerPrice = price - (gridStep * gridCount / 2);
        gridActive = true;
    }

    for (let i = 1; i < atrArr.length; i++) {
        const idx   = i + offset;
        const high  = highs[idx];
        const low   = lows[idx];
        const close = closes[idx];
        const atr   = atrArr[i];

        if (!atr || atr <= 0) continue;

        // 首次初始化
        if (!gridActive) {
            resetGrid(close, atr);
            continue;
        }

        // 破網判斷
        const brokeOut = high > upperPrice || low < lowerPrice;
        if (brokeOut) {
            // 估算破網損失：價格跑出去的距離 × 平均持倉
            const overshoot = high > upperPrice
                ? high - upperPrice
                : lowerPrice - low;
            const avgPositionSize = (CONFIG.investment * CONFIG.leverage) / gridCount;
            const breakoutLoss = avgPositionSize * (overshoot / close) * (gridCount / 2) * -1;

            equity    += breakoutLoss;
            totalPnl  += breakoutLoss;
            totalResets++;

            // 更新峰值與回撤
            if (equity > peakEquity) peakEquity = equity;
            const dd = peakEquity > 0 ? (peakEquity - equity) / peakEquity * 100 : 0;
            if (dd > maxDrawdown) maxDrawdown = dd;

            // 重置網格
            resetGrid(close, atr);
            continue;
        }

        // 計算這根 K 線觸發的格子數
        const range = high - low;
        if (gridStep > 0 && range > 0) {
            const fills = Math.min(Math.floor(range / gridStep), gridCount - 1);
            if (fills > 0) {
                // 每個往返成交：賺 gridStep / price × 每格投入
                const posPerGrid  = (CONFIG.investment * CONFIG.leverage) / gridCount;
                const profitPerFill = posPerGrid * (gridStep / close);
                const feePerFill    = posPerGrid * CONFIG.feeRate * 2; // 進出各一次
                const netPerFill    = profitPerFill - feePerFill;

                const candlePnl = netPerFill * fills;
                equity   += candlePnl;
                totalPnl += candlePnl;
                totalFills += fills;
            }
        }

        // 更新峰值與回撤
        if (equity > peakEquity) peakEquity = equity;
        const dd = peakEquity > 0 ? (peakEquity - equity) / peakEquity * 100 : 0;
        if (dd > maxDrawdown) maxDrawdown = dd;
    }

    return {
        finalEquity: equity,
        totalPnl,
        maxDrawdown,
        totalFills,
        totalResets,
    };
}

// ===== 儲存最佳結果到 DB =====
function saveBestResult(db, symbol, bestParams, bestResult, sidewaysScore) {
    const { atrMultiplier, gridCount } = bestParams;
    const { finalEquity, totalPnl, maxDrawdown, totalFills } = bestResult;
    const strategyName = `GRID_ATR${atrMultiplier}_N${gridCount}_${CONFIG.timeframe}`;
    const totalPnlPct  = totalPnl / CONFIG.investment * 100;

    const stmt = db.prepare(`
        INSERT INTO backtest_runs
        (strategy, run_at, symbol, timeframe, days_back, ema_fast, ema_slow,
         atr_stop_mult, atr_tp_mult, leverage, investment,
         final_equity, total_pnl, total_pnl_pct, max_drawdown,
         trade_count, win_count, win_rate, avg_win, avg_loss)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        strategyName,
        new Date().toISOString(),
        symbol,
        CONFIG.timeframe,
        DAYS_BACK,
        gridCount,          // ema_fast 欄位借用存 gridCount
        0,                  // ema_slow 不適用
        atrMultiplier,      // atr_stop_mult 借用存 atrMultiplier
        sidewaysScore,      // atr_tp_mult 借用存橫盤分數
        CONFIG.leverage,
        CONFIG.investment,
        finalEquity,
        totalPnl,
        totalPnlPct,
        maxDrawdown,
        totalFills,         // trade_count = 成交格子數
        0,                  // win_count 不適用
        sidewaysScore,      // win_rate 借用存橫盤分數
        0,
        0,
    );
}

// ===== 主流程 =====
async function main() {
    console.log(`\n${'='.repeat(65)}`);
    console.log(`🕸️  網格策略回測 - ${TARGET_SYMBOL}`);
    console.log(`回測天數: ${DAYS_BACK} 天 | K線: ${CONFIG.timeframe} | 資金: ${CONFIG.investment}U`);
    console.log(`${'='.repeat(65)}\n`);

    // 初始化 DB
    const db = initDB();

    // 抓取 1h K 線（回測用）
    console.log(`📡 下載 ${CONFIG.timeframe} K線資料...`);
    let ohlcv1h;
    try {
        await exchange.loadMarkets();
        ohlcv1h = await fetchOHLCV(TARGET_SYMBOL, CONFIG.timeframe, DAYS_BACK);
    } catch (e) {
        console.error(`❌ 無法取得資料: ${e.message}`);
        process.exit(1);
    }

    if (ohlcv1h.length < CONFIG.minCandles) {
        console.error(`❌ K線不足 (${ohlcv1h.length}/${CONFIG.minCandles})，無法回測`);
        process.exit(1);
    }
    console.log(`✅ 取得 ${ohlcv1h.length} 根 K線 (${new Date(ohlcv1h[0][0]).toLocaleDateString()} ~ ${new Date(ohlcv1h[ohlcv1h.length-1][0]).toLocaleDateString()})`);

    // 抓取 4h K 線（計算橫盤分數用）
    console.log(`📡 下載 4h K線計算橫盤分數...`);
    let ohlcv4h;
    try {
        ohlcv4h = await fetchOHLCV(TARGET_SYMBOL, '4h', DAYS_BACK);
    } catch (e) {
        console.log(`⚠️ 4h K線取得失敗，橫盤分數設為 0`);
        ohlcv4h = [];
    }
    const sidewaysScore = calcSidewaysScore(ohlcv4h, CONFIG.maPeriod, CONFIG.maThreshold);
    console.log(`📊 橫盤分數: ${sidewaysScore.toFixed(1)}%（${sidewaysScore >= 50 ? '✅ 適合網格' : sidewaysScore >= 30 ? '⚠️ 一般' : '❌ 趨勢偏強'}）\n`);

    // 參數優化：遍歷所有組合
    console.log(`🔬 參數優化中 (${CONFIG.atrMultipliers.length} × ${CONFIG.gridCounts.length} = ${CONFIG.atrMultipliers.length * CONFIG.gridCounts.length} 組)...\n`);
    console.log(`${'ATR倍數'.padEnd(10)} ${'格數'.padEnd(6)} ${'總盈虧'.padEnd(12)} ${'報酬率'.padEnd(10)} ${'最大回撤'.padEnd(10)} ${'成交格'.padEnd(8)} 破網次`);
    console.log('-'.repeat(65));

    let bestResult = null;
    let bestParams = null;
    let bestScore  = -Infinity;
    const allResults = [];

    for (const atrMultiplier of CONFIG.atrMultipliers) {
        for (const gridCount of CONFIG.gridCounts) {
            const result = runGridBacktest(ohlcv1h, atrMultiplier, gridCount);
            const { finalEquity, totalPnl, maxDrawdown, totalFills, totalResets } = result;
            const pct   = totalPnl / CONFIG.investment * 100;
            const emoji = pct >= 0 ? '✅' : '❌';
            const sign  = pct >= 0 ? '+' : '';

            console.log(
                `${('ATR×' + atrMultiplier).padEnd(10)} ` +
                `${String(gridCount).padEnd(6)} ` +
                `${(emoji + ' ' + sign + totalPnl.toFixed(2) + 'U').padEnd(12)} ` +
                `${((sign + pct.toFixed(1) + '%').padEnd(10))} ` +
                `${((maxDrawdown.toFixed(1) + '%').padEnd(10))} ` +
                `${String(totalFills).padEnd(8)} ` +
                `${totalResets}`
            );

            allResults.push({ atrMultiplier, gridCount, ...result, pct });

            // 評分：報酬率 60% + 低回撤 40%（回撤越低越好）
            const score = pct * 0.6 - maxDrawdown * 0.4;
            if (score > bestScore) {
                bestScore  = score;
                bestResult = result;
                bestParams = { atrMultiplier, gridCount };
            }
        }
    }

    // 輸出最佳結果
    console.log('\n' + '='.repeat(65));
    console.log(`🏆 最佳參數組合`);
    console.log('='.repeat(65));

    const bp = bestParams;
    const br = bestResult;
    const pct = br.totalPnl / CONFIG.investment * 100;
    const sign = pct >= 0 ? '+' : '';

    console.log(`幣種:      ${TARGET_SYMBOL}`);
    console.log(`ATR倍數:   ${bp.atrMultiplier}  (格距 = ATR × ${bp.atrMultiplier})`);
    console.log(`格數:      ${bp.gridCount}`);
    console.log(`---`);
    console.log(`總盈虧:    ${sign}${br.totalPnl.toFixed(2)} USDT (${sign}${pct.toFixed(2)}%)`);
    console.log(`最終權益:  ${br.finalEquity.toFixed(2)} USDT`);
    console.log(`最大回撤:  ${br.maxDrawdown.toFixed(2)}%`);
    console.log(`成交格數:  ${br.totalFills} 次`);
    console.log(`破網重置:  ${br.totalResets} 次`);
    console.log(`橫盤分數:  ${sidewaysScore.toFixed(1)}%`);
    console.log('='.repeat(65));

    // 建議
    console.log(`\n💡 建議：`);
    if (sidewaysScore >= 50) {
        console.log(`• ${TARGET_SYMBOL} 橫盤特性良好，適合跑網格`);
    } else if (sidewaysScore >= 30) {
        console.log(`• ${TARGET_SYMBOL} 橫盤特性一般，需配合嚴格趨勢過濾`);
    } else {
        console.log(`• ${TARGET_SYMBOL} 趨勢行情偏多，不太適合網格，建議考慮其他幣種`);
    }
    if (br.maxDrawdown > 30) {
        console.log(`• 回撤較高 (${br.maxDrawdown.toFixed(1)}%)，建議降低槓桿或減少格數`);
    }
    if (br.totalResets > 50) {
        console.log(`• 破網頻繁 (${br.totalResets} 次)，可試試調大 ATR 倍數擴大範圍`);
    }
    console.log(`• 建議在 grid_bot_multi.js 中設定:`);
    console.log(`  atrMultiplier: ${bp.atrMultiplier}`);
    console.log(`  gridCount: ${bp.gridCount}`);

    // 儲存到 DB
    saveBestResult(db, TARGET_SYMBOL, bp, br, sidewaysScore);
    console.log(`\n💾 結果已儲存至 backtest.db (strategy=GRID_ATR${bp.atrMultiplier}_N${bp.gridCount}_${CONFIG.timeframe})`);

    db.close();
}

main().catch(console.error);
