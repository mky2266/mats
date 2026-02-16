/**
 * backtest_batch.js - 批次回測成交量前 N 名幣種（改良版策略）
 *
 * 策略：EMA20/50 交叉 + RSI過濾 + 量能確認 + 移動停損 + 只做多
 *
 * 使用方式：
 *   node backtest_batch.js          # 前 100 名
 *   node backtest_batch.js 50       # 前 50 名
 */

import ccxt from 'ccxt';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { EMA, ATR, RSI } from 'technicalindicators';

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
    atrTrailActivate: 1.0,     // 獲利達 1x ATR 後啟動移動停損
    atrTrailDistance: 1.5,     // 移動停損距離 1.5x ATR
    rsiPeriod: 14,
    rsiMaxBuy: 65,             // RSI > 65 不進場
    volumeMaPeriod: 20,
    volumeMinRatio: 1.2,       // 成交量需 > 均量 * 1.2
    longOnly: true,
    feeRate: 0.0004,
    daysBack: 365,
    minCandles: 200,
};

const DB_PATH = path.join(__dirname, 'backtest.db');
const exchange = new ccxt.binance({ options: { defaultType: 'future' } });

function initDB() {
    const db = new Database(DB_PATH);
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

async function getTopSymbols(n) {
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

function calcVolumeMa(volumes, period) {
    const result = [];
    for (let i = 0; i < volumes.length; i++) {
        if (i < period - 1) { result.push(null); continue; }
        const slice = volumes.slice(i - period + 1, i + 1);
        result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
    return result;
}

function runBacktest(ohlcv) {
    const closes  = ohlcv.map(c => c[4]);
    const highs   = ohlcv.map(c => c[2]);
    const lows    = ohlcv.map(c => c[3]);
    const volumes = ohlcv.map(c => c[5]);
    const times   = ohlcv.map(c => c[0]);

    const emaFastArr = EMA.calculate({ period: CONFIG.emaFast, values: closes });
    const emaSlowArr = EMA.calculate({ period: CONFIG.emaSlow, values: closes });
    const atrArr     = ATR.calculate({ period: CONFIG.atrPeriod, high: highs, low: lows, close: closes });
    const rsiArr     = RSI.calculate({ period: CONFIG.rsiPeriod, values: closes });
    const volMaArr   = calcVolumeMa(volumes, CONFIG.volumeMaPeriod);

    const offset    = closes.length - emaSlowArr.length;
    const len       = emaSlowArr.length;
    const rsiOffset = closes.length - rsiArr.length;

    let equity = CONFIG.investment;
    let position = null;
    let trades = [];
    let lastSignal = null;
    let peakEquity = equity;
    let maxDrawdown = 0;

    for (let i = 1; i < len; i++) {
        const idx = i + offset;
        const price       = closes[idx];
        const time        = new Date(times[idx]).toISOString().slice(0, 10);
        const emaFast     = emaFastArr[i];
        const emaFastPrev = emaFastArr[i - 1];
        const emaSlow     = emaSlowArr[i];
        const emaSlowPrev = emaSlowArr[i - 1];
        const atr         = atrArr[i - 1] || atrArr[0];
        const rsiIdx      = idx - rsiOffset;
        const rsi         = rsiIdx >= 0 && rsiIdx < rsiArr.length ? rsiArr[rsiIdx] : 50;
        const vol         = volumes[idx];
        const volMa       = volMaArr[idx];

        if (equity > peakEquity) peakEquity = equity;
        const drawdown = (peakEquity - equity) / peakEquity * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;

        // 持倉管理（移動停損）
        if (position) {
            const { entryPrice, stopLoss } = position;
            let { trailActivated } = position;
            let closed = false, closeReason = '', closePrice = price;

            const profit = (price - entryPrice) / entryPrice * CONFIG.leverage;
            const atrActivateThreshold = CONFIG.atrTrailActivate * atr / entryPrice * CONFIG.leverage;

            if (!trailActivated && profit >= atrActivateThreshold) {
                position.trailActivated = true;
                position.trailStop = price - atr * CONFIG.atrTrailDistance;
                trailActivated = true;
            }
            if (trailActivated) {
                const newTrail = price - atr * CONFIG.atrTrailDistance;
                if (newTrail > position.trailStop) position.trailStop = newTrail;
                if (price <= position.trailStop) {
                    closed = true; closeReason = '移動停損'; closePrice = position.trailStop;
                }
            }
            if (!closed && price <= stopLoss) {
                closed = true; closeReason = '停損'; closePrice = stopLoss;
            }
            if (!closed && emaFastPrev >= emaSlowPrev && emaFast < emaSlow) {
                closed = true; closeReason = '死叉出場'; closePrice = price;
            }
            if (closed) {
                const pct = (closePrice - entryPrice) / entryPrice;
                const fee = equity * CONFIG.leverage * CONFIG.feeRate * 2;
                const netPnl = equity * CONFIG.leverage * pct - fee;
                equity += netPnl;
                trades.push({ time, side: 'long', entryPrice: entryPrice.toFixed(4), closePrice: closePrice.toFixed(4), reason: closeReason, pnl: netPnl, equity: equity.toFixed(2) });
                position = null;
            }
        }

        // 進場（黃金交叉 + RSI + 量能）
        const isGoldenCross = emaFastPrev <= emaSlowPrev && emaFast > emaSlow;
        if (isGoldenCross && lastSignal !== 'golden_cross' && !position) {
            lastSignal = 'golden_cross';
            if (rsi <= CONFIG.rsiMaxBuy && (!volMa || vol >= volMa * CONFIG.volumeMinRatio)) {
                position = {
                    side: 'long',
                    entryPrice: price,
                    stopLoss: price - atr * CONFIG.atrStopMultiplier,
                    trailActivated: false,
                    trailStop: null,
                };
            }
        }
        if (emaFastPrev >= emaSlowPrev && emaFast < emaSlow) {
            lastSignal = 'death_cross';
        }
    }

    return { trades, finalEquity: equity, maxDrawdown };
}

function saveResult(db, symbol, result) {
    const { trades, finalEquity, maxDrawdown } = result;
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const totalPnl = finalEquity - CONFIG.investment;
    const strategyName = `EMAv2_RSI+VOL+Trail_${CONFIG.timeframe}`;

    const r = db.prepare(`
        INSERT INTO backtest_runs
        (strategy, run_at, symbol, timeframe, days_back, ema_fast, ema_slow, atr_stop_mult, atr_tp_mult,
         leverage, investment, final_equity, total_pnl, total_pnl_pct, max_drawdown,
         trade_count, win_count, win_rate, avg_win, avg_loss)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        strategyName, new Date().toISOString(), symbol, CONFIG.timeframe, CONFIG.daysBack,
        CONFIG.emaFast, CONFIG.emaSlow, CONFIG.atrStopMultiplier, CONFIG.atrTrailDistance,
        CONFIG.leverage, CONFIG.investment,
        finalEquity, totalPnl, totalPnl / CONFIG.investment * 100,
        maxDrawdown, trades.length, wins.length,
        trades.length > 0 ? wins.length / trades.length * 100 : 0,
        wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0,
        losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0,
    );

    const runId = r.lastInsertRowid;
    const tradeStmt = db.prepare(`INSERT INTO backtest_trades (run_id, trade_time, side, entry_price, close_price, close_reason, pnl, equity_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    db.transaction((trades) => {
        for (const t of trades) tradeStmt.run(runId, t.time, t.side, parseFloat(t.entryPrice), parseFloat(t.closePrice), t.reason, t.pnl, parseFloat(t.equity));
    })(trades);
    return runId;
}

async function main() {
    console.log(`🚀 批次回測開始 - 成交量前 ${TOP_N} 幣種（改良版）`);
    console.log(`策略: EMA${CONFIG.emaFast}/${CONFIG.emaSlow} + RSI<${CONFIG.rsiMaxBuy} + 量能>${CONFIG.volumeMinRatio}x + 移動停損 + 只做多\n`);

    const db = initDB();
    const symbols = await getTopSymbols(TOP_N);
    console.log(`✅ 取得 ${symbols.length} 個幣種，開始逐一回測...\n`);

    const results = [];
    let skipped = 0;

    for (let idx = 0; idx < symbols.length; idx++) {
        const symbol = symbols[idx];
        const label = `[${idx + 1}/${symbols.length}]`;
        try {
            const ohlcv = await fetchData(symbol);
            if (ohlcv.length < CONFIG.minCandles) {
                console.log(`${label} ${symbol.padEnd(24)} ⏭️ 跳過（K線不足 ${ohlcv.length}/${CONFIG.minCandles}）`);
                skipped++;
                continue;
            }
            const result = runBacktest(ohlcv);
            saveResult(db, symbol, result);

            const { trades, finalEquity, maxDrawdown } = result;
            const totalPnl = finalEquity - CONFIG.investment;
            const pct = totalPnl / CONFIG.investment * 100;
            const wins = trades.filter(t => t.pnl > 0);
            const winRate = trades.length > 0 ? (wins.length / trades.length * 100).toFixed(0) : 0;
            const emoji = pct >= 0 ? '✅' : '❌';
            console.log(`${label.padEnd(8)} ${symbol.padEnd(24)} ${emoji} ${(pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'} | 回撤:${maxDrawdown.toFixed(1)}% | 勝率:${winRate}% | ${trades.length}次`);

            results.push({ symbol, pct, maxDrawdown, winRate: parseFloat(winRate), trades: trades.length });
        } catch (e) {
            console.log(`${label} ${symbol.padEnd(24)} ⚠️ 失敗: ${e.message.slice(0, 40)}`);
            skipped++;
        }
        await new Promise(r => setTimeout(r, 100));
    }

    // 排名輸出
    results.sort((a, b) => b.pct - a.pct);
    const profitable = results.filter(r => r.pct >= 0);
    const losing = results.filter(r => r.pct < 0);

    console.log('\n' + '='.repeat(85));
    console.log(`📊 改良版策略 - 成交量前 ${TOP_N} 幣種回測排名`);
    console.log('='.repeat(85));
    console.log(`${'排名'.padEnd(5)} ${'幣種'.padEnd(24)} ${'報酬率'.padEnd(10)} ${'盈虧(U)'.padEnd(10)} ${'最大回撤'.padEnd(10)} ${'勝率'.padEnd(8)} ${'次數'}`);
    console.log('-'.repeat(85));

    results.forEach((r, i) => {
        const sign = r.pct >= 0 ? '+' : '';
        const emoji = r.pct >= 0 ? '✅' : '❌';
        const pnlU = (r.pct / 100 * CONFIG.investment).toFixed(2);
        console.log(
            `${emoji} ${String(i + 1).padEnd(4)} ` +
            `${r.symbol.padEnd(24)} ` +
            `${(sign + r.pct.toFixed(1) + '%').padEnd(10)} ` +
            `${(sign + pnlU).padEnd(10)} ` +
            `${(r.maxDrawdown.toFixed(1) + '%').padEnd(10)} ` +
            `${(r.winRate + '%').padEnd(8)} ` +
            `${r.trades}`
        );
    });

    console.log(`\n⚠️ 跳過 ${skipped} 個幣種（數據不足或失敗）`);
    console.log(`\n📊 統計：共 ${results.length} 個幣種 | 獲利 ${profitable.length} 個 (${(profitable.length / results.length * 100).toFixed(0)}%) | 虧損 ${losing.length} 個`);
    console.log(`💾 所有結果已儲存至 backtest.db`);
    console.log(`🔍 查詢：node backtest_trend.js query`);
    console.log('='.repeat(85));

    db.close();
}

main().catch(console.error);
