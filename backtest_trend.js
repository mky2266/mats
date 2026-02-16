/**
 * backtest_trend.js - 趨勢追蹤策略回測（含資料庫儲存）
 *
 * 使用方式：
 *   node backtest_trend.js                    # 回測預設幣種（改良版策略）
 *   node backtest_trend.js BTC/USDT:USDT      # 指定幣種
 *   node backtest_trend.js query              # 查詢歷史回測結果
 *   node backtest_trend.js query BTC/USDT:USDT # 查詢特定幣種
 *
 * 改良 v2：
 *   - RSI 過濾（只做多）：RSI < 65 才進場，避免追高
 *   - 成交量確認：交叉時成交量需 > 過去20根均量 * 1.2
 *   - 移動停損（Trailing Stop）：獲利超過 1x ATR 後啟動跟蹤
 *   - 只做多：空單勝率低，只交易黃金交叉
 */

import ccxt from 'ccxt';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { EMA, ATR, RSI } from 'technicalindicators';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

// ========== 設定 ==========
const BACKTEST_CONFIG = {
    symbol: process.argv[2] && process.argv[2] !== 'query' ? process.argv[2] : 'BTC/USDT:USDT',
    timeframe: '4h',
    investment: 90,
    leverage: 2,
    emaFast: 20,
    emaSlow: 50,
    atrPeriod: 14,
    atrStopMultiplier: 2.0,       // 初始停損 2x ATR
    atrTrailActivate: 1.0,        // 獲利達 1x ATR 後啟動移動停損
    atrTrailDistance: 1.5,        // 移動停損距離 1.5x ATR
    rsiPeriod: 14,
    rsiMaxBuy: 65,                // RSI > 65 不做多（超買）
    volumeMaPeriod: 20,           // 成交量均線週期
    volumeMinRatio: 1.2,          // 進場時成交量需 > 均量 * 1.2
    longOnly: true,               // 只做多
    feeRate: 0.0004,
    daysBack: 365,
};

// ========== 資料庫初始化 ==========
const DB_PATH = path.join(__dirname, 'backtest.db');

function initDB() {
    const db = new Database(DB_PATH);
    // 相容舊資料庫：若 strategy 欄位不存在則新增
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

        CREATE TABLE IF NOT EXISTS backtest_trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL,
            trade_time TEXT,
            side TEXT,
            entry_price REAL,
            close_price REAL,
            close_reason TEXT,
            pnl REAL,
            equity_after REAL,
            FOREIGN KEY (run_id) REFERENCES backtest_runs(id)
        );
    `);
    return db;
}

function saveResults(db, config, result) {
    const { trades, finalEquity, maxDrawdown } = result;
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const winRate = trades.length > 0 ? wins.length / trades.length * 100 : 0;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
    const totalPnl = finalEquity - config.investment;

    const runStmt = db.prepare(`
        INSERT INTO backtest_runs
        (strategy, run_at, symbol, timeframe, days_back, ema_fast, ema_slow, atr_stop_mult, atr_tp_mult,
         leverage, investment, final_equity, total_pnl, total_pnl_pct, max_drawdown,
         trade_count, win_count, win_rate, avg_win, avg_loss)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const strategyName = `EMAv2_RSI+VOL+Trail_${config.timeframe}`;
    const runResult = runStmt.run(
        strategyName,
        new Date().toISOString(),
        config.symbol, config.timeframe, config.daysBack,
        config.emaFast, config.emaSlow, config.atrStopMultiplier, config.atrTrailDistance,
        config.leverage, config.investment,
        finalEquity, totalPnl, totalPnl / config.investment * 100,
        maxDrawdown, trades.length, wins.length, winRate, avgWin, avgLoss
    );

    const runId = runResult.lastInsertRowid;

    const tradeStmt = db.prepare(`
        INSERT INTO backtest_trades (run_id, trade_time, side, entry_price, close_price, close_reason, pnl, equity_after)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((trades) => {
        for (const t of trades) {
            tradeStmt.run(runId, t.time, t.side, parseFloat(t.entryPrice), parseFloat(t.closePrice), t.reason, t.pnl, parseFloat(t.equity));
        }
    });
    insertMany(trades);

    return runId;
}

// ========== 查詢模式 ==========
function queryResults(db, symbol) {
    let rows;
    if (symbol) {
        rows = db.prepare(`
            SELECT * FROM backtest_runs WHERE symbol = ? ORDER BY run_at DESC LIMIT 10
        `).all(symbol);
    } else {
        rows = db.prepare(`
            SELECT * FROM backtest_runs ORDER BY run_at DESC LIMIT 20
        `).all();
    }

    if (rows.length === 0) {
        console.log('尚無回測記錄');
        return;
    }

    console.log('\n' + '='.repeat(110));
    console.log('📊 歷史回測記錄');
    console.log('='.repeat(110));
    console.log(`${'ID'.padEnd(4)} ${'日期'.padEnd(12)} ${'策略'.padEnd(28)} ${'幣種'.padEnd(16)} ${'報酬率'.padEnd(10)} ${'盈虧(U)'.padEnd(10)} ${'回撤'.padEnd(8)} ${'勝率'.padEnd(8)} ${'次數'}`);
    console.log('-'.repeat(110));

    for (const r of rows) {
        const pnlSign = r.total_pnl >= 0 ? '+' : '';
        const emoji = r.total_pnl >= 0 ? '✅' : '❌';
        const strategy = (r.strategy || 'EMA_CROSSOVER').padEnd(28);
        console.log(
            `${emoji} ${String(r.id).padEnd(3)} ` +
            `${r.run_at.slice(0, 10).padEnd(12)} ` +
            `${strategy} ` +
            `${r.symbol.padEnd(16)} ` +
            `${(pnlSign + r.total_pnl_pct.toFixed(1) + '%').padEnd(10)} ` +
            `${(pnlSign + r.total_pnl.toFixed(2)).padEnd(10)} ` +
            `${(r.max_drawdown.toFixed(1) + '%').padEnd(8)} ` +
            `${(r.win_rate.toFixed(1) + '%').padEnd(8)} ` +
            `${r.trade_count}`
        );
    }

    // 最佳幣種排名（依策略分組）
    const best = db.prepare(`
        SELECT strategy, symbol, AVG(total_pnl_pct) as avg_pnl, AVG(max_drawdown) as avg_dd, COUNT(*) as runs
        FROM backtest_runs GROUP BY strategy, symbol ORDER BY avg_pnl DESC LIMIT 10
    `).all();

    if (best.length > 1) {
        console.log('\n🏆 幣種平均績效排名（依策略）：');
        for (const b of best) {
            const sign = b.avg_pnl >= 0 ? '+' : '';
            console.log(`  [${b.strategy || 'EMA_CROSSOVER'}] ${b.symbol}: ${sign}${b.avg_pnl.toFixed(1)}% | 平均回撤: ${b.avg_dd.toFixed(1)}% (${b.runs} 次)`);
        }
    }
    console.log('='.repeat(110));
}

// ========== 下載歷史數據 ==========
const exchange = new ccxt.binance({ options: { defaultType: 'future' } });

async function fetchHistoricalData(symbol, timeframe, daysBack) {
    console.log(`📥 下載 ${symbol} ${timeframe} 過去 ${daysBack} 天歷史數據...`);
    const since = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    let all = [];
    let from = since;
    while (true) {
        const d = await exchange.fetchOHLCV(symbol, timeframe, from, 1000);
        if (!d.length) break;
        all = all.concat(d);
        const last = d[d.length - 1][0];
        if (last >= Date.now() - 4 * 60 * 60 * 1000) break;
        from = last + 1;
        await new Promise(r => setTimeout(r, 200));
    }
    console.log(`✅ 共下載 ${all.length} 根 K 線`);
    return all;
}

// ========== 計算成交量移動平均 ==========
function calcVolumeMa(volumes, period) {
    const result = [];
    for (let i = 0; i < volumes.length; i++) {
        if (i < period - 1) { result.push(null); continue; }
        const slice = volumes.slice(i - period + 1, i + 1);
        result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
    return result;
}

// ========== 回測引擎（改良版） ==========
function runBacktest(ohlcv) {
    const closes  = ohlcv.map(c => c[4]);
    const highs   = ohlcv.map(c => c[2]);
    const lows    = ohlcv.map(c => c[3]);
    const volumes = ohlcv.map(c => c[5]);
    const times   = ohlcv.map(c => c[0]);

    const emaFastArr = EMA.calculate({ period: BACKTEST_CONFIG.emaFast, values: closes });
    const emaSlowArr = EMA.calculate({ period: BACKTEST_CONFIG.emaSlow, values: closes });
    const atrArr     = ATR.calculate({ period: BACKTEST_CONFIG.atrPeriod, high: highs, low: lows, close: closes });
    const rsiArr     = RSI.calculate({ period: BACKTEST_CONFIG.rsiPeriod, values: closes });
    const volMaArr   = calcVolumeMa(volumes, BACKTEST_CONFIG.volumeMaPeriod);

    // 對齊到最短的陣列（emaSlow 最長，是基準）
    const offset = closes.length - emaSlowArr.length;
    const len = emaSlowArr.length;

    // RSI 和 volMa 需要額外對齊
    const rsiOffset  = closes.length - rsiArr.length;
    const atrOffset  = closes.length - (atrArr.length + 1); // ATR 從 index 1 開始用

    let equity = BACKTEST_CONFIG.investment;
    let position = null;
    let trades = [];
    let lastSignal = null;
    let peakEquity = equity;
    let maxDrawdown = 0;

    // 統計過濾原因
    let filteredRsi = 0, filteredVol = 0, totalSignals = 0;

    for (let i = 1; i < len; i++) {
        const idx = i + offset;  // 對應 closes[] 的索引

        const price      = closes[idx];
        const time       = new Date(times[idx]).toISOString().slice(0, 10);
        const emaFast    = emaFastArr[i];
        const emaFastPrev = emaFastArr[i - 1];
        const emaSlow    = emaSlowArr[i];
        const emaSlowPrev = emaSlowArr[i - 1];
        const atr        = atrArr[i - 1] || atrArr[0];

        // RSI（對齊）
        const rsiIdx = idx - rsiOffset;
        const rsi = rsiIdx >= 0 && rsiIdx < rsiArr.length ? rsiArr[rsiIdx] : 50;

        // 成交量（對齊）
        const vol    = volumes[idx];
        const volMa  = volMaArr[idx];

        // 峰值回撤追蹤
        if (equity > peakEquity) peakEquity = equity;
        const drawdown = (peakEquity - equity) / peakEquity * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;

        // ===== 持倉管理（移動停損） =====
        if (position) {
            const { side, entryPrice } = position;
            let { stopLoss, trailActivated } = position;
            let closed = false, closeReason = '', closePrice = price;

            // 只做多，只管理 long
            const profit = (price - entryPrice) / entryPrice * BACKTEST_CONFIG.leverage;
            const atrActivateThreshold = BACKTEST_CONFIG.atrTrailActivate * atr / entryPrice * BACKTEST_CONFIG.leverage;

            // 啟動移動停損條件：獲利 > 1x ATR
            if (!trailActivated && profit >= atrActivateThreshold) {
                position.trailActivated = true;
                position.trailStop = price - atr * BACKTEST_CONFIG.atrTrailDistance;
                trailActivated = true;
            }

            // 移動停損跟進
            if (trailActivated) {
                const newTrail = price - atr * BACKTEST_CONFIG.atrTrailDistance;
                if (newTrail > position.trailStop) position.trailStop = newTrail;
                if (price <= position.trailStop) {
                    closed = true; closeReason = '移動停損'; closePrice = position.trailStop;
                }
            }

            // 初始固定停損
            if (!closed && price <= stopLoss) {
                closed = true; closeReason = '停損'; closePrice = stopLoss;
            }

            // EMA 死叉平倉（反向訊號）
            if (!closed && emaFastPrev >= emaSlowPrev && emaFast < emaSlow) {
                closed = true; closeReason = '死叉出場'; closePrice = price;
            }

            if (closed) {
                const pct = (closePrice - entryPrice) / entryPrice;
                const fee = equity * BACKTEST_CONFIG.leverage * BACKTEST_CONFIG.feeRate * 2;
                const netPnl = equity * BACKTEST_CONFIG.leverage * pct - fee;
                equity += netPnl;
                trades.push({ time, side, entryPrice: entryPrice.toFixed(4), closePrice: closePrice.toFixed(4), reason: closeReason, pnl: netPnl, equity: equity.toFixed(2) });
                position = null;
            }
        }

        // ===== 進場訊號（黃金交叉，只做多） =====
        const isGoldenCross = emaFastPrev <= emaSlowPrev && emaFast > emaSlow;

        if (isGoldenCross && lastSignal !== 'golden_cross' && !position) {
            totalSignals++;
            lastSignal = 'golden_cross';

            // 過濾1：RSI 超買
            if (rsi > BACKTEST_CONFIG.rsiMaxBuy) {
                filteredRsi++;
                continue;
            }

            // 過濾2：成交量確認
            if (volMa && vol < volMa * BACKTEST_CONFIG.volumeMinRatio) {
                filteredVol++;
                continue;
            }

            // 進場
            position = {
                side: 'long',
                entryPrice: price,
                stopLoss: price - atr * BACKTEST_CONFIG.atrStopMultiplier,
                trailActivated: false,
                trailStop: null,
            };
        }

        // 死叉重置信號狀態（讓下次黃金交叉可以進場）
        if (emaFastPrev >= emaSlowPrev && emaFast < emaSlow) {
            lastSignal = 'death_cross';
        }
    }

    return { trades, finalEquity: equity, maxDrawdown, peakEquity, filteredRsi, filteredVol, totalSignals };
}

// ========== 輸出結果 ==========
function printResults(result, runId) {
    const { trades, finalEquity, maxDrawdown, filteredRsi, filteredVol, totalSignals } = result;
    const initial = BACKTEST_CONFIG.investment;
    const totalPnl = finalEquity - initial;
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const winRate = trades.length > 0 ? (wins.length / trades.length * 100).toFixed(1) : 0;
    const avgWin = wins.length > 0 ? (wins.reduce((s, t) => s + t.pnl, 0) / wins.length).toFixed(2) : 0;
    const avgLoss = losses.length > 0 ? (losses.reduce((s, t) => s + t.pnl, 0) / losses.length).toFixed(2) : 0;

    console.log('\n' + '='.repeat(55));
    console.log(`📊 回測結果 #${runId} - ${BACKTEST_CONFIG.symbol}`);
    console.log(`策略: EMA${BACKTEST_CONFIG.emaFast}/${BACKTEST_CONFIG.emaSlow} + RSI過濾 + 量能確認 + 移動停損（只做多）`);
    console.log('='.repeat(55));
    console.log(`初始資金:     ${initial} USDT`);
    console.log(`最終資金:     ${finalEquity.toFixed(2)} USDT`);
    console.log(`總盈虧:       ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} USDT (${(totalPnl / initial * 100).toFixed(2)}%)`);
    console.log(`最大回撤:     ${maxDrawdown.toFixed(2)}%`);
    console.log(`總交易次數:   ${trades.length} 次`);
    console.log(`勝率:         ${winRate}%`);
    console.log(`平均獲利:     +${avgWin} USDT`);
    console.log(`平均虧損:     ${avgLoss} USDT`);
    console.log('--- 過濾統計 ---');
    console.log(`黃金交叉訊號: ${totalSignals} 次`);
    console.log(`RSI過濾掉:    ${filteredRsi} 次（RSI > ${BACKTEST_CONFIG.rsiMaxBuy}）`);
    console.log(`量能過濾掉:   ${filteredVol} 次（量能不足 ${BACKTEST_CONFIG.volumeMinRatio}x 均量）`);
    console.log(`實際進場:     ${trades.length} 次`);
    console.log('='.repeat(55));

    const recent = trades.slice(-10);
    if (recent.length > 0) {
        console.log('\n最近 10 筆交易：');
        console.log('-'.repeat(85));
        for (const t of recent) {
            const emoji = t.pnl > 0 ? '✅' : '❌';
            console.log(`${emoji} ${t.time} | ${t.side.toUpperCase()} | 進: ${t.entryPrice} → 出: ${t.closePrice} | ${t.reason} | PnL: ${t.pnl.toFixed(2)}U | 餘額: ${t.equity}U`);
        }
    }
    console.log('\n💾 結果已儲存至 backtest.db（ID: ' + runId + '）');
    console.log('查詢歷史：node backtest_trend.js query');
    console.log('='.repeat(55));
}

// ========== 主程式 ==========
async function main() {
    const db = initDB();
    const mode = process.argv[2];

    // 查詢模式
    if (mode === 'query') {
        const filterSymbol = process.argv[3] || null;
        queryResults(db, filterSymbol);
        db.close();
        return;
    }

    console.log(`🚀 趨勢追蹤策略回測 v2（改良版）`);
    console.log(`設定: ${BACKTEST_CONFIG.symbol} | ${BACKTEST_CONFIG.timeframe} | EMA${BACKTEST_CONFIG.emaFast}/${BACKTEST_CONFIG.emaSlow}`);
    console.log(`改良: RSI<${BACKTEST_CONFIG.rsiMaxBuy} | 量能>${BACKTEST_CONFIG.volumeMinRatio}x | 移動停損 | 只做多`);

    try {
        const ohlcv = await fetchHistoricalData(BACKTEST_CONFIG.symbol, BACKTEST_CONFIG.timeframe, BACKTEST_CONFIG.daysBack);
        if (ohlcv.length < BACKTEST_CONFIG.emaSlow + 10) { console.log('❌ 數據不足'); return; }

        const result = runBacktest(ohlcv);
        const runId = saveResults(db, BACKTEST_CONFIG, result);
        printResults(result, runId);
    } catch (e) {
        console.log(`❌ 回測失敗: ${e.message}`);
        console.error(e);
    } finally {
        db.close();
    }
}

main();
