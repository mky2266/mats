/**
 * backtest_batch.js - 批次回測成交量前 N 名幣種
 *
 * 使用方式：
 *   node backtest_batch.js          # 前 100 名
 *   node backtest_batch.js 50       # 前 50 名
 */

import ccxt from 'ccxt';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { EMA, ATR } from 'technicalindicators';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOP_N = parseInt(process.argv[2]) || 100;
const CONFIG = {
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
    minCandles: 200,   // 至少要有 200 根 K 線才回測
};

const DB_PATH = path.join(__dirname, 'backtest.db');
const exchange = new ccxt.binance({ options: { defaultType: 'future' } });

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

async function getTop100Symbols(n) {
    console.log(`📡 取得成交量前 ${n} 名幣種...`);
    await exchange.loadMarkets();
    const tickers = await exchange.fetchTickers();
    return Object.values(tickers)
        .filter(t => {
            if (!t.symbol.includes(':USDT')) return false;
            const market = exchange.markets[t.symbol];
            if (!market || !market.active) return false;
            if (!market.info.contractType || market.info.contractType !== 'PERPETUAL') return false;
            return t.quoteVolume > 0;
        })
        .sort((a, b) => b.quoteVolume - a.quoteVolume)
        .slice(0, n)
        .map(t => t.symbol);
}

async function fetchData(symbol) {
    const since = Date.now() - CONFIG.daysBack * 24 * 60 * 60 * 1000;
    let all = [];
    let from = since;
    while (true) {
        const d = await exchange.fetchOHLCV(symbol, CONFIG.timeframe, from, 1000);
        if (!d.length) break;
        all = all.concat(d);
        const last = d[d.length - 1][0];
        if (last >= Date.now() - 4 * 60 * 60 * 1000) break;
        from = last + 1;
        await new Promise(r => setTimeout(r, 150));
    }
    return all;
}

function runBacktest(ohlcv) {
    const closes = ohlcv.map(c => c[4]);
    const highs = ohlcv.map(c => c[2]);
    const lows = ohlcv.map(c => c[3]);
    const times = ohlcv.map(c => c[0]);

    const emaFastArr = EMA.calculate({ period: CONFIG.emaFast, values: closes });
    const emaSlowArr = EMA.calculate({ period: CONFIG.emaSlow, values: closes });
    const atrArr = ATR.calculate({ period: CONFIG.atrPeriod, high: highs, low: lows, close: closes });

    const offset = closes.length - emaSlowArr.length;
    const len = emaSlowArr.length;

    let equity = CONFIG.investment;
    let position = null, trades = [], lastSignal = null;
    let peakEquity = equity, maxDrawdown = 0;

    for (let i = 1; i < len; i++) {
        const idx = i + offset;
        const price = closes[idx];
        const time = new Date(times[idx]).toISOString().slice(0, 10);
        const emaFast = emaFastArr[i], emaFastPrev = emaFastArr[i - 1];
        const emaSlow = emaSlowArr[i], emaSlowPrev = emaSlowArr[i - 1];
        const atr = atrArr[i - 1] || atrArr[0];

        if (equity > peakEquity) peakEquity = equity;
        const dd = (peakEquity - equity) / peakEquity * 100;
        if (dd > maxDrawdown) maxDrawdown = dd;

        if (position) {
            const { side, entryPrice, stopLoss, takeProfit } = position;
            let closed = false, cr = '', cp = price;
            if (side === 'long') {
                if (price <= stopLoss) { closed = true; cr = '停損'; cp = stopLoss; }
                else if (price >= takeProfit) { closed = true; cr = '停利'; cp = takeProfit; }
            } else {
                if (price >= stopLoss) { closed = true; cr = '停損'; cp = stopLoss; }
                else if (price <= takeProfit) { closed = true; cr = '停利'; cp = takeProfit; }
            }
            if (closed) {
                const pct = side === 'long' ? (cp - entryPrice) / entryPrice : (entryPrice - cp) / entryPrice;
                const fee = equity * CONFIG.leverage * CONFIG.feeRate * 2;
                const netPnl = equity * CONFIG.leverage * pct - fee;
                equity += netPnl;
                trades.push({ time, side, entryPrice: entryPrice.toFixed(4), closePrice: cp.toFixed(4), reason: cr, pnl: netPnl, equity: equity.toFixed(2) });
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
                const fee = equity * CONFIG.leverage * CONFIG.feeRate * 2;
                const netPnl = equity * CONFIG.leverage * pct - fee;
                equity += netPnl;
                trades.push({ time, side, entryPrice: entryPrice.toFixed(4), closePrice: price.toFixed(4), reason: '反向訊號', pnl: netPnl, equity: equity.toFixed(2) });
                position = null;
            }
            const side = signal === 'golden_cross' ? 'long' : 'short';
            position = {
                side, entryPrice: price,
                stopLoss: side === 'long' ? price - atr * CONFIG.atrStopMultiplier : price + atr * CONFIG.atrStopMultiplier,
                takeProfit: side === 'long' ? price + atr * CONFIG.atrTpMultiplier : price - atr * CONFIG.atrTpMultiplier,
            };
        }
    }
    return { trades, finalEquity: equity, maxDrawdown };
}

function saveResult(db, symbol, result) {
    const { trades, finalEquity, maxDrawdown } = result;
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const totalPnl = finalEquity - CONFIG.investment;

    const runStmt = db.prepare(`
        INSERT INTO backtest_runs
        (strategy, run_at, symbol, timeframe, days_back, ema_fast, ema_slow, atr_stop_mult, atr_tp_mult,
         leverage, investment, final_equity, total_pnl, total_pnl_pct, max_drawdown,
         trade_count, win_count, win_rate, avg_win, avg_loss)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const strategyName = `EMA${CONFIG.emaFast}/${CONFIG.emaSlow}_ATR${CONFIG.atrStopMultiplier}x_${CONFIG.timeframe}`;
    const r = runStmt.run(
        strategyName,
        new Date().toISOString(), symbol, CONFIG.timeframe, CONFIG.daysBack,
        CONFIG.emaFast, CONFIG.emaSlow, CONFIG.atrStopMultiplier, CONFIG.atrTpMultiplier,
        CONFIG.leverage, CONFIG.investment,
        finalEquity, totalPnl, totalPnl / CONFIG.investment * 100,
        maxDrawdown, trades.length, wins.length,
        trades.length > 0 ? wins.length / trades.length * 100 : 0,
        wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0,
        losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0,
    );

    const runId = r.lastInsertRowid;
    const tradeStmt = db.prepare(`INSERT INTO backtest_trades (run_id, trade_time, side, entry_price, close_price, close_reason, pnl, equity_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertMany = db.transaction((trades) => {
        for (const t of trades) tradeStmt.run(runId, t.time, t.side, parseFloat(t.entryPrice), parseFloat(t.closePrice), t.reason, t.pnl, parseFloat(t.equity));
    });
    insertMany(trades);
    return runId;
}

function printSummary(db, batchResults) {
    console.log('\n' + '='.repeat(85));
    console.log(`🏆 批次回測完成 - TOP ${TOP_N} 幣種績效排名`);
    console.log('='.repeat(85));
    console.log(`${'排名'.padEnd(5)} ${'幣種'.padEnd(18)} ${'報酬率'.padEnd(10)} ${'盈虧(U)'.padEnd(10)} ${'回撤'.padEnd(8)} ${'勝率'.padEnd(8)} ${'次數'}`);
    console.log('-'.repeat(85));

    const sorted = batchResults.filter(r => r.success).sort((a, b) => b.pnlPct - a.pnlPct);
    sorted.forEach((r, i) => {
        const emoji = r.pnlPct >= 0 ? '✅' : '❌';
        const sign = r.pnlPct >= 0 ? '+' : '';
        console.log(
            `${emoji} ${String(i + 1).padEnd(4)} ` +
            `${r.symbol.padEnd(18)} ` +
            `${(sign + r.pnlPct.toFixed(1) + '%').padEnd(10)} ` +
            `${(sign + r.pnl.toFixed(2)).padEnd(10)} ` +
            `${(r.maxDrawdown.toFixed(1) + '%').padEnd(8)} ` +
            `${(r.winRate.toFixed(1) + '%').padEnd(8)} ` +
            `${r.tradeCount}`
        );
    });

    const skipped = batchResults.filter(r => !r.success);
    if (skipped.length > 0) {
        console.log(`\n⚠️ 跳過 ${skipped.length} 個幣種（數據不足或下載失敗）`);
    }

    const profitable = sorted.filter(r => r.pnlPct > 0);
    console.log(`\n📊 統計：共 ${sorted.length} 個幣種 | 獲利 ${profitable.length} 個 (${(profitable.length / sorted.length * 100).toFixed(0)}%) | 虧損 ${sorted.length - profitable.length} 個`);
    console.log(`💾 所有結果已儲存至 backtest.db`);
    console.log(`🔍 查詢：node backtest_trend.js query`);
    console.log('='.repeat(85));
}

async function main() {
    console.log(`🚀 批次回測開始 - 成交量前 ${TOP_N} 幣種`);
    console.log(`設定: EMA${CONFIG.emaFast}/${CONFIG.emaSlow} | ATR停損${CONFIG.atrStopMultiplier}x | 停利${CONFIG.atrTpMultiplier}x | 槓桿${CONFIG.leverage}x\n`);

    const db = initDB();
    const symbols = await getTop100Symbols(TOP_N);
    console.log(`✅ 取得 ${symbols.length} 個幣種，開始逐一回測...\n`);

    const batchResults = [];

    for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        process.stdout.write(`[${i + 1}/${symbols.length}] ${symbol.padEnd(20)} `);

        try {
            const ohlcv = await fetchData(symbol);
            if (ohlcv.length < CONFIG.minCandles) {
                console.log(`⏭️ 跳過（K線不足 ${ohlcv.length}/${CONFIG.minCandles}）`);
                batchResults.push({ symbol, success: false });
                continue;
            }

            const result = runBacktest(ohlcv);
            saveResult(db, symbol, result);

            const pnl = result.finalEquity - CONFIG.investment;
            const pnlPct = pnl / CONFIG.investment * 100;
            const wins = result.trades.filter(t => t.pnl > 0);
            const winRate = result.trades.length > 0 ? wins.length / result.trades.length * 100 : 0;
            const sign = pnl >= 0 ? '+' : '';
            const emoji = pnl >= 0 ? '✅' : '❌';

            console.log(`${emoji} ${sign}${pnlPct.toFixed(1)}% (${sign}${pnl.toFixed(1)}U) | 回撤:${result.maxDrawdown.toFixed(1)}% | 勝率:${winRate.toFixed(0)}% | ${result.trades.length}次`);
            batchResults.push({ symbol, success: true, pnl, pnlPct, maxDrawdown: result.maxDrawdown, winRate, tradeCount: result.trades.length });

        } catch (e) {
            console.log(`❌ 失敗: ${e.message.slice(0, 50)}`);
            batchResults.push({ symbol, success: false });
        }

        await new Promise(r => setTimeout(r, 300));
    }

    printSummary(db, batchResults);
    db.close();
}

main();
