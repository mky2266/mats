/**
 * backtest_trend.js - 趨勢追蹤策略回測（含資料庫儲存）
 *
 * 使用方式：
 *   node backtest_trend.js                    # 回測預設幣種
 *   node backtest_trend.js BTC/USDT:USDT      # 指定幣種
 *   node backtest_trend.js query              # 查詢歷史回測結果
 *   node backtest_trend.js query BTC/USDT:USDT # 查詢特定幣種
 */

import ccxt from 'ccxt';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { EMA, ATR } from 'technicalindicators';

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
    atrStopMultiplier: 2.0,
    atrTpMultiplier: 3.0,
    feeRate: 0.0004,
    daysBack: 365,
};

// ========== 資料庫初始化 ==========
const DB_PATH = path.join(__dirname, 'backtest.db');

function initDB() {
    const db = new Database(DB_PATH);
    db.exec(`
        CREATE TABLE IF NOT EXISTS backtest_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        (run_at, symbol, timeframe, days_back, ema_fast, ema_slow, atr_stop_mult, atr_tp_mult,
         leverage, investment, final_equity, total_pnl, total_pnl_pct, max_drawdown,
         trade_count, win_count, win_rate, avg_win, avg_loss)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const runResult = runStmt.run(
        new Date().toISOString(),
        config.symbol, config.timeframe, config.daysBack,
        config.emaFast, config.emaSlow, config.atrStopMultiplier, config.atrTpMultiplier,
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

    console.log('\n' + '='.repeat(90));
    console.log('📊 歷史回測記錄');
    console.log('='.repeat(90));
    console.log(`${'ID'.padEnd(4)} ${'日期'.padEnd(12)} ${'幣種'.padEnd(16)} ${'報酬率'.padEnd(10)} ${'盈虧(U)'.padEnd(10)} ${'回撤'.padEnd(8)} ${'勝率'.padEnd(8)} ${'次數'.padEnd(6)}`);
    console.log('-'.repeat(90));

    for (const r of rows) {
        const pnlSign = r.total_pnl >= 0 ? '+' : '';
        const emoji = r.total_pnl >= 0 ? '✅' : '❌';
        console.log(
            `${emoji} ${String(r.id).padEnd(3)} ` +
            `${r.run_at.slice(0, 10).padEnd(12)} ` +
            `${r.symbol.padEnd(16)} ` +
            `${(pnlSign + r.total_pnl_pct.toFixed(1) + '%').padEnd(10)} ` +
            `${(pnlSign + r.total_pnl.toFixed(2)).padEnd(10)} ` +
            `${(r.max_drawdown.toFixed(1) + '%').padEnd(8)} ` +
            `${(r.win_rate.toFixed(1) + '%').padEnd(8)} ` +
            `${r.trade_count}`
        );
    }

    // 最佳幣種排名
    const best = db.prepare(`
        SELECT symbol, AVG(total_pnl_pct) as avg_pnl, COUNT(*) as runs
        FROM backtest_runs GROUP BY symbol ORDER BY avg_pnl DESC LIMIT 5
    `).all();

    if (best.length > 1) {
        console.log('\n🏆 幣種平均績效排名：');
        for (const b of best) {
            const sign = b.avg_pnl >= 0 ? '+' : '';
            console.log(`  ${b.symbol}: ${sign}${b.avg_pnl.toFixed(1)}% (${b.runs} 次回測)`);
        }
    }
    console.log('='.repeat(90));
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

// ========== 回測引擎 ==========
function runBacktest(ohlcv) {
    const closes = ohlcv.map(c => c[4]);
    const highs = ohlcv.map(c => c[2]);
    const lows = ohlcv.map(c => c[3]);
    const times = ohlcv.map(c => c[0]);

    const emaFastArr = EMA.calculate({ period: BACKTEST_CONFIG.emaFast, values: closes });
    const emaSlowArr = EMA.calculate({ period: BACKTEST_CONFIG.emaSlow, values: closes });
    const atrArr = ATR.calculate({ period: BACKTEST_CONFIG.atrPeriod, high: highs, low: lows, close: closes });

    const offset = closes.length - emaSlowArr.length;
    const len = emaSlowArr.length;

    let equity = BACKTEST_CONFIG.investment;
    let position = null;
    let trades = [];
    let lastSignal = null;
    let peakEquity = equity;
    let maxDrawdown = 0;

    for (let i = 1; i < len; i++) {
        const idx = i + offset;
        const price = closes[idx];
        const time = new Date(times[idx]).toISOString().slice(0, 10);
        const emaFast = emaFastArr[i];
        const emaFastPrev = emaFastArr[i - 1];
        const emaSlow = emaSlowArr[i];
        const emaSlowPrev = emaSlowArr[i - 1];
        const atr = atrArr[i - 1] || atrArr[0];

        if (equity > peakEquity) peakEquity = equity;
        const drawdown = (peakEquity - equity) / peakEquity * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;

        if (position) {
            const { side, entryPrice, stopLoss, takeProfit } = position;
            let closed = false, closeReason = '', closePrice = price;
            if (side === 'long') {
                if (price <= stopLoss) { closed = true; closeReason = '停損'; closePrice = stopLoss; }
                else if (price >= takeProfit) { closed = true; closeReason = '停利'; closePrice = takeProfit; }
            } else {
                if (price >= stopLoss) { closed = true; closeReason = '停損'; closePrice = stopLoss; }
                else if (price <= takeProfit) { closed = true; closeReason = '停利'; closePrice = takeProfit; }
            }
            if (closed) {
                const pct = side === 'long' ? (closePrice - entryPrice) / entryPrice : (entryPrice - closePrice) / entryPrice;
                const fee = equity * BACKTEST_CONFIG.leverage * BACKTEST_CONFIG.feeRate * 2;
                const netPnl = equity * BACKTEST_CONFIG.leverage * pct - fee;
                equity += netPnl;
                trades.push({ time, side, entryPrice: entryPrice.toFixed(4), closePrice: closePrice.toFixed(4), reason: closeReason, pnl: netPnl, equity: equity.toFixed(2) });
                position = null;
            }
        }

        let signal = null;
        if (emaFastPrev <= emaSlowPrev && emaFast > emaSlow) signal = 'golden_cross';
        else if (emaFastPrev >= emaSlowPrev && emaFast < emaSlow) signal = 'death_cross';

        if (signal && signal !== lastSignal) {
            lastSignal = signal;
            if (position) {
                const { side, entryPrice } = position;
                const pct = side === 'long' ? (price - entryPrice) / entryPrice : (entryPrice - price) / entryPrice;
                const fee = equity * BACKTEST_CONFIG.leverage * BACKTEST_CONFIG.feeRate * 2;
                const netPnl = equity * BACKTEST_CONFIG.leverage * pct - fee;
                equity += netPnl;
                trades.push({ time, side, entryPrice: entryPrice.toFixed(4), closePrice: price.toFixed(4), reason: '反向訊號', pnl: netPnl, equity: equity.toFixed(2) });
                position = null;
            }
            const side = signal === 'golden_cross' ? 'long' : 'short';
            position = {
                side, entryPrice: price,
                stopLoss: side === 'long' ? price - atr * BACKTEST_CONFIG.atrStopMultiplier : price + atr * BACKTEST_CONFIG.atrStopMultiplier,
                takeProfit: side === 'long' ? price + atr * BACKTEST_CONFIG.atrTpMultiplier : price - atr * BACKTEST_CONFIG.atrTpMultiplier,
            };
        }
    }

    return { trades, finalEquity: equity, maxDrawdown, peakEquity };
}

// ========== 輸出結果 ==========
function printResults(result, runId) {
    const { trades, finalEquity, maxDrawdown } = result;
    const initial = BACKTEST_CONFIG.investment;
    const totalPnl = finalEquity - initial;
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const winRate = trades.length > 0 ? (wins.length / trades.length * 100).toFixed(1) : 0;
    const avgWin = wins.length > 0 ? (wins.reduce((s, t) => s + t.pnl, 0) / wins.length).toFixed(2) : 0;
    const avgLoss = losses.length > 0 ? (losses.reduce((s, t) => s + t.pnl, 0) / losses.length).toFixed(2) : 0;

    console.log('\n' + '='.repeat(50));
    console.log(`📊 回測結果 #${runId} - ${BACKTEST_CONFIG.symbol}`);
    console.log('='.repeat(50));
    console.log(`初始資金:     ${initial} USDT`);
    console.log(`最終資金:     ${finalEquity.toFixed(2)} USDT`);
    console.log(`總盈虧:       ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} USDT (${(totalPnl / initial * 100).toFixed(2)}%)`);
    console.log(`最大回撤:     ${maxDrawdown.toFixed(2)}%`);
    console.log(`總交易次數:   ${trades.length} 次`);
    console.log(`勝率:         ${winRate}%`);
    console.log(`平均獲利:     ${avgWin} USDT`);
    console.log(`平均虧損:     ${avgLoss} USDT`);
    console.log('='.repeat(50));

    const recent = trades.slice(-10);
    if (recent.length > 0) {
        console.log('\n最近 10 筆交易：');
        console.log('-'.repeat(80));
        for (const t of recent) {
            const emoji = t.pnl > 0 ? '✅' : '❌';
            console.log(`${emoji} ${t.time} | ${t.side.toUpperCase()} | 進: ${t.entryPrice} → 出: ${t.closePrice} | ${t.reason} | PnL: ${t.pnl.toFixed(2)}U | 餘額: ${t.equity}U`);
        }
    }
    console.log('\n💾 結果已儲存至 backtest.db（ID: ' + runId + '）');
    console.log('查詢歷史：node backtest_trend.js query');
    console.log('='.repeat(50));
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

    console.log(`🚀 趨勢追蹤策略回測`);
    console.log(`設定: ${BACKTEST_CONFIG.symbol} | ${BACKTEST_CONFIG.timeframe} | EMA${BACKTEST_CONFIG.emaFast}/${BACKTEST_CONFIG.emaSlow} | 槓桿 ${BACKTEST_CONFIG.leverage}x`);

    try {
        const ohlcv = await fetchHistoricalData(BACKTEST_CONFIG.symbol, BACKTEST_CONFIG.timeframe, BACKTEST_CONFIG.daysBack);
        if (ohlcv.length < BACKTEST_CONFIG.emaSlow + 10) { console.log('❌ 數據不足'); return; }

        const result = runBacktest(ohlcv);
        const runId = saveResults(db, BACKTEST_CONFIG, result);
        printResults(result, runId);
    } catch (e) {
        console.log(`❌ 回測失敗: ${e.message}`);
    } finally {
        db.close();
    }
}

main();
