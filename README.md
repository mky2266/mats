# 🤖 MATS - 加密貨幣多交易所自動交易系統

**MATS** (Multi-exchange Automated Trading System)

一套完整的加密貨幣自動交易系統，支援趨勢跟隨和網格交易策略，可在 Binance、Bybit、OKX、Bitget 等主流交易所運行。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey.svg)]()

---

## 📋 目錄

- [功能特色](#-功能特色)
- [系統架構](#-系統架構)
- [支援的交易所](#-支援的交易所)
- [系統需求](#-系統需求)
- [Windows 安裝](#-windows-安裝)
- [Linux 安裝](#-linux-安裝)
- [手機安裝 (Android)](#-手機安裝-android)
- [配置說明](#-配置說明)
- [啟動機器人](#-啟動機器人)
- [使用指南](#-使用指南)
- [常見問題](#-常見問題)
- [安全建議](#-安全建議)

---

## ✨ 功能特色

### 🎯 **三大核心機器人**

1. **市場掃描器** - 自動掃描高流動性幣種，每 12 小時更新
2. **趨勢交易機器人** - EMA + ADX + RSI 多指標策略，動態止損
3. **網格交易機器人** - ATR 動態網格，自動幣種輪動

### 🌐 **多交易所支援**

- ✅ 支援 Binance、Bybit、OKX、Bitget
- ✅ 一行代碼切換交易所
- ✅ 自動處理 API 差異
- ✅ 可同時運行多個交易所

---

## 🏗️ 系統架構

```
exchange_config.js (統一配置中心)
    │
    ├─→ market_scanner_multi.js  (市場掃描器)
    ├─→ bot_multi.js              (趨勢機器人)
    └─→ grid_bot_multi.js         (網格機器人)
         ↓
    market_data.json
         ↓
    calculate_profit_multi.js    (收益計算)
```

---

## 🌐 支援的交易所

| 交易所 | 手續費 (Maker/Taker) | 特色 |
|--------|---------------------|------|
| **Binance** | 0.02% / 0.04% | 流動性最高 |
| **Bybit** | -0.025% / 0.075% | Maker 返傭 |
| **OKX** | 0.02% / 0.05% | 產品豐富 |
| **Bitget** | 0.02% / 0.06% | 跟單功能 |

---

## 💻 系統需求

### **電腦（Windows/Linux）**
- **Node.js**: 18.0.0 或更高
- **記憶體**: 最低 1GB，建議 2GB+
- **硬碟**: 500MB 可用空間
- **網路**: 穩定連線

### **手機（Android）**
- **系統**: Android 7.0+
- **記憶體**: 最低 2GB，建議 4GB+
- **儲存**: 2GB 可用空間
- **應用**: Termux（F-Droid）
- **建議**: 連接充電器

---

## 🪟 Windows 安裝

### **步驟 1：安裝 Node.js**

1. 前往 [nodejs.org](https://nodejs.org/)
2. 下載 **LTS 版本**
3. 執行安裝（勾選所有選項）
4. 重啟電腦

**驗證：**
```cmd
node --version
npm --version
```

---

### **步驟 2：創建目錄**

```cmd
cd Desktop
mkdir crypto-bot
cd crypto-bot
```

---

### **步驟 3：放置檔案**

將所有檔案放入 `crypto-bot` 資料夾：
```
crypto-bot/
├── exchange_config.js
├── market_scanner_multi.js
├── bot_multi.js
├── grid_bot_multi.js
├── calculate_profit_multi.js
├── ecosystem.config.cjs          ← 注意是 .cjs
└── .env.example                  ← API 範本
```

**重要：** 配置檔名稱是 `ecosystem.config.cjs`（副檔名 `.cjs`），不是 `.js`

---

### **步驟 4：安裝套件**

```cmd
npm init -y
npm install ccxt dotenv technicalindicators
```

**加速安裝（可選）：**
```cmd
npm config set registry https://registry.npmmirror.com
npm install ccxt dotenv technicalindicators
```

---

### **步驟 5：安裝 PM2**

```cmd
npm install -g pm2
```

**如遇權限問題：**
- 右鍵「命令提示字元」→ 以系統管理員身分執行

---

### **步驟 6：配置 API**

```cmd
copy .env.example .env
notepad .env
```

填入 API 金鑰：
```env
BINANCE_API_KEY=你的金鑰
BINANCE_SECRET=你的密鑰
```

---

### **步驟 7：選擇交易所**

```cmd
notepad exchange_config.js
```

修改第 5 行：
```javascript
export const EXCHANGE_NAME = 'binance';
```

---

### **步驟 8：創建日誌目錄**

```cmd
mkdir logs
```

---

### **步驟 9：啟動**

```cmd
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs
```

---

### **步驟 10：開機自動啟動（可選）**

```cmd
npm install -g pm2-windows-startup
pm2-startup install
pm2 save
```

---

## 🐧 Linux 安裝

### **步驟 1：安裝 Node.js**

**Ubuntu/Debian:**
```bash
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

**CentOS/RHEL:**
```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs
```

**使用 NVM（推薦）:**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

**驗證：**
```bash
node --version
npm --version
```

---

### **步驟 2：創建目錄**

```bash
mkdir -p ~/crypto-bot
cd ~/crypto-bot
```

---

### **步驟 3：上傳檔案**

**方法 A：使用 SCP**
```bash
scp *.js user@server:~/crypto-bot/
```

**方法 B：手動創建**
```bash
nano exchange_config.js
# 貼上內容，Ctrl+O 儲存，Ctrl+X 退出
```

---

### **步驟 4：安裝套件**

```bash
npm init -y
npm install ccxt dotenv technicalindicators
```

---

### **步驟 5：安裝 PM2**

```bash
sudo npm install -g pm2
pm2 --version
```

---

### **步驟 6：配置 API**

```bash
cp .env.example .env
nano .env
```

填入 API 金鑰，按 `Ctrl+O` 儲存，`Ctrl+X` 退出

---

### **步驟 7：選擇交易所**

```bash
nano exchange_config.js
```

修改第 5 行

---

### **步驟 8：設置權限**

```bash
mkdir -p logs
chmod +x *.js
chmod 600 .env
```

---

### **步驟 9：啟動**

```bash
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs
```

---

### **步驟 10：開機自動啟動**

```bash
pm2 startup
# 執行輸出的指令（需要 sudo）
pm2 save
```

---

## 📱 手機安裝 (Android)

### **前置準備**

1. **下載 Termux**
   - Google Play: [Termux](https://play.google.com/store/apps/details?id=com.termux)
   - F-Droid（推薦）: [F-Droid Termux](https://f-droid.org/packages/com.termux/)
   
2. **為什麼推薦 F-Droid 版本？**
   - Google Play 版本可能不是最新
   - F-Droid 版本更新更及時

---

### **步驟 1：更新 Termux 套件**

開啟 Termux，執行：

```bash
# 更新套件列表
pkg update

# 升級所有套件（會詢問是否繼續，輸入 y）
pkg upgrade
```

**提示：** 如果提示 "Do you want to continue? [Y/n]"，輸入 `y` 並按 Enter

---

### **步驟 2：安裝必要套件**

```bash
# 安裝 Node.js 和 Git
pkg install nodejs git

# 驗證安裝
node --version
npm --version
```

**應該顯示：**
```
v20.x.x
10.x.x
```

---

### **步驟 3：允許訪問儲存空間（可選）**

如果需要從手機下載檔案：

```bash
termux-setup-storage
```

**會彈出權限請求，點選「允許」**

---

### **步驟 4：創建專案目錄**

```bash
# 創建目錄
mkdir -p ~/Crypto_Bot_Multi
cd ~/Crypto_Bot_Multi
```

---

### **步驟 5：上傳檔案到手機**

#### **方法 A：使用電腦傳輸**

1. **手機連接電腦（USB）**
2. **將所有 .js 檔案複製到：**
   ```
   內部儲存空間/Download/
   ```
3. **在 Termux 中複製檔案：**
   ```bash
   cp ~/storage/downloads/*.js ~/Crypto_Bot_Multi/
   cp ~/storage/downloads/.env.example ~/Crypto_Bot_Multi/
   ```

#### **方法 B：使用 Termux FTP**

```bash
# 安裝 FTP 伺服器
pkg install openssh

# 啟動 SSH 服務
sshd

# 查看用戶名和 IP
whoami
ifconfig
```

**從電腦使用 SFTP 上傳檔案**

#### **方法 C：直接下載（如果有 GitHub/URL）**

```bash
# 使用 wget 或 curl 下載
wget https://your-url/exchange_config.js
# 或
curl -O https://your-url/exchange_config.js
```

#### **方法 D：手動創建（逐個檔案）**

```bash
# 使用 nano 編輯器創建檔案
nano exchange_config.js

# 貼上內容
# 按 Ctrl + O 儲存
# 按 Ctrl + X 退出
```

---

### **步驟 6：初始化專案**

```bash
# 確認在正確目錄
pwd
# 應該顯示：/data/data/com.termux/files/home/Crypto_Bot_Multi

# 列出檔案
ls -la

# 創建 package.json
cat > package.json << 'EOF'
{
  "name": "crypto-bot-multi",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "ccxt": "^4.2.25",
    "dotenv": "^16.4.1",
    "technicalindicators": "^3.1.0"
  }
}
EOF
```

---

### **步驟 7：安裝依賴套件**

```bash
# 使用淘寶鏡像加速
npm config set registry https://registry.npmmirror.com

# 安裝依賴
npm install

# 驗證安裝
ls node_modules/ | grep -E "ccxt|dotenv|technical"
```

**應該看到：**
```
ccxt
dotenv
technicalindicators
```

---

### **步驟 8：安裝 PM2**

```bash
npm install -g pm2

# 驗證
pm2 --version
```

---

### **步驟 9：配置 API 金鑰**

```bash
# 複製範本
cp .env.example .env

# 編輯 .env
nano .env
```

**填入您的 API 金鑰：**
```env
BINANCE_API_KEY=你的金鑰
BINANCE_SECRET=你的密鑰
```

**儲存並退出：**
- 按 `Ctrl + O`（儲存）
- 按 `Enter`（確認）
- 按 `Ctrl + X`（退出）

---

### **步驟 10：選擇交易所**

```bash
nano exchange_config.js
```

**修改第 5 行：**
```javascript
export const EXCHANGE_NAME = 'binance';
```

---

### **步驟 11：創建日誌目錄**

```bash
mkdir -p logs
```

---

### **步驟 12：啟動機器人**

```bash
# 方法 1：使用配置檔（推薦）
pm2 start ecosystem.config.cjs

# 方法 2：單獨啟動
pm2 start market_scanner_multi.js --name "market-scanner"
pm2 start bot_multi.js --name "trend-bot"
pm2 start grid_bot_multi.js --name "grid-bot"

# 查看狀態
pm2 status

# 查看日誌
pm2 logs
```

---

### **步驟 13：保持 Termux 背景運行**

#### **方法 A：使用 Wake Lock（推薦）**

1. **安裝 Termux:Boot**（從 F-Droid）
2. **在 Termux 中執行：**
   ```bash
   # 防止 Termux 被殺掉
   termux-wake-lock
   ```

#### **方法 B：使用通知鎖定**

在 Termux 設定中：
- Settings → Termux → 電池最佳化 → 不要最佳化

#### **方法 C：開機自動啟動**

```bash
# 創建啟動腳本
mkdir -p ~/.termux/boot
nano ~/.termux/boot/start-bots.sh
```

**內容：**
```bash
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
cd ~/Crypto_Bot_Multi
pm2 resurrect
```

**設置權限：**
```bash
chmod +x ~/.termux/boot/start-bots.sh
```

---

### **📱 手機特別注意事項**

#### **1. 電池管理**

**防止被系統殺掉：**
```bash
# 執行 wake lock
termux-wake-lock

# 檢查是否生效
pm2 status
```

**手機設定：**
- 關閉「電池最佳化」
- 允許 Termux 背景運行
- 加入「不清理」白名單

---

#### **2. 網路連線**

**確保穩定連線：**
- 使用 WiFi（推薦）
- 避免頻繁切換網路
- 確保信號穩定

**測試連線：**
```bash
ping -c 5 api.binance.com
```

---

#### **3. 儲存空間**

**檢查可用空間：**
```bash
df -h
```

**至少需要：** 500MB 可用空間

---

#### **4. 效能優化**

**降低記憶體使用：**
```bash
# 只啟動必要的機器人
pm2 start market_scanner_multi.js --name "scanner"

# 限制記憶體
pm2 start bot_multi.js --name "trend-bot" --max-memory-restart 200M
```

---

### **🔧 手機常用指令**

#### **查看機器人狀態**
```bash
pm2 status
pm2 monit
```

#### **查看日誌**
```bash
pm2 logs --lines 20
```

#### **重啟機器人**
```bash
pm2 restart all
```

#### **停止機器人**
```bash
pm2 stop all
```

#### **儲存配置（重啟後恢復）**
```bash
pm2 save
```

#### **手機鎖屏後恢復**
```bash
# 如果 PM2 進程被殺
pm2 resurrect
```

---

### **📊 手機運行效能參考**

| 機器人 | 記憶體使用 | CPU 使用 |
|--------|-----------|---------|
| market-scanner | ~50MB | ~1% |
| trend-bot | ~80MB | ~2% |
| grid-bot | ~90MB | ~2% |
| **總計** | **~220MB** | **~5%** |

**建議手機配置：**
- RAM: 4GB 以上
- 儲存: 2GB 以上可用空間
- 電池: 連接充電器長期運行

---

### **⚠️ 手機特別提醒**

1. **不建議長期使用手機運行**
   - 手機可能過熱
   - 電池損耗
   - 系統可能殺掉背景進程

2. **推薦用途**
   - 測試和學習
   - 臨時運行
   - 監控和管理

3. **生產環境建議**
   - 使用 VPS 或雲端伺服器
   - 使用電腦（Windows/Linux）

---

### **🆘 手機常見問題**

#### **Q: Termux 被系統殺掉？**

**A:** 
```bash
# 1. 執行 wake lock
termux-wake-lock

# 2. 在系統設定中：
# - 關閉電池最佳化
# - 加入白名單
# - 允許自動啟動
```

---

#### **Q: 手機太熱？**

**A:** 
```bash
# 只運行必要的機器人
pm2 stop grid-bot
pm2 stop trend-bot

# 或降低檢查頻率（修改 CONFIG）
```

---

#### **Q: npm install 失敗？**

**A:** 
```bash
# 清除快取
npm cache clean --force

# 使用淘寶鏡像
npm config set registry https://registry.npmmirror.com

# 重新安裝
rm -rf node_modules
npm install
```

---

#### **Q: 如何遠程監控？**

**A:** 
```bash
# 方法 1：使用 SSH
pkg install openssh
sshd
# 從電腦 SSH 連入手機

# 方法 2：使用 Web UI
pm2 install pm2-web
# 瀏覽器訪問 http://手機IP:9000
```

---

## ⚙️ 配置說明

### **1. .env.example（API 金鑰範本）**

**這個檔案是範本，需要複製並填入您的 API 金鑰。**

```bash
# Windows
copy .env.example .env

# Linux
cp .env.example .env
```

**完整範本內容：**
```env
# ========== Binance API ==========
BINANCE_API_KEY=your_binance_api_key_here
BINANCE_SECRET=your_binance_secret_here

# ========== Bybit API ==========
BYBIT_API_KEY=your_bybit_api_key_here
BYBIT_SECRET=your_bybit_secret_here

# ========== OKX API ==========
OKX_API_KEY=your_okx_api_key_here
OKX_SECRET=your_okx_secret_here
OKX_PASSWORD=your_okx_password_here

# ========== Bitget API ==========
BITGET_API_KEY=your_bitget_api_key_here
BITGET_SECRET=your_bitget_secret_here
BITGET_PASSWORD=your_bitget_password_here
```

**填入範例：**
```env
# 如果您使用 Binance，填入實際金鑰
BINANCE_API_KEY=vF8sK3mP9wQ2xR7yT4nU6hJ8kL5pN3mQ
BINANCE_SECRET=aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV

# 其他交易所可以不填（如果不使用）
BYBIT_API_KEY=
BYBIT_SECRET=
```

---

### **2. exchange_config.js**

```javascript
export const EXCHANGE_NAME = 'binance';  // binance, bybit, okx, bitget
```

---

## 🎮 啟動機器人

### **方法 1：使用配置檔啟動（推薦）**

```bash
# 啟動所有機器人
pm2 start ecosystem.config.cjs

# 查看狀態
pm2 status

# 查看日誌
pm2 logs

# 重啟
pm2 restart all

# 停止
pm2 stop all
```

### **方法 2：單獨啟動**

```bash
# 單獨啟動市場掃描器
pm2 start market_scanner_multi.js --name "market-scanner"

# 單獨啟動趨勢機器人
pm2 start bot_multi.js --name "trend-bot"

# 單獨啟動網格機器人
pm2 start grid_bot_multi.js --name "grid-bot"
```

---

## 📖 使用指南

### **首次運行**

```bash
# 1. 啟動掃描器
pm2 start market_scanner_multi.js --name "scanner"

# 2. 等待 5-10 分鐘，確認 market_data.json 生成
ls -lh market_data.json

# 3. 啟動交易機器人
pm2 start bot_multi.js --name "trend-bot"
pm2 start grid_bot_multi.js --name "grid-bot"
```

### **日常監控**

```bash
pm2 monit          # 即時監控
pm2 status         # 狀態查看
pm2 logs --lines 50  # 查看日誌
```

### **計算收益**

```bash
node calculate_profit_multi.js
```

### **切換交易所**

```bash
pm2 stop all
nano exchange_config.js  # 修改 EXCHANGE_NAME
pm2 restart all
```

---

## ❓ 常見問題

### **Q: npm install 很慢？**

```bash
npm config set registry https://registry.npmmirror.com
npm install
```

---

### **Q: PM2 權限錯誤？**

**Windows:** 以管理員身份執行  
**Linux:** 使用 `sudo npm install -g pm2`

---

### **Q: .env 檔案無效？**

確認檔案名稱是 `.env` 而不是 `.env.txt`

```bash
# Linux
ls -la .env

# Windows
dir .env
```

---

### **Q: API 金鑰錯誤？**

檢查：
- ✅ 金鑰完整（無空格）
- ✅ .env 格式正確
- ✅ EXCHANGE_NAME 正確
- ✅ API 權限包含「交易」
- ✅ IP 白名單已設置

---

### **Q: 機器人一直重啟？**

```bash
pm2 logs --err  # 查看錯誤
```

常見原因：
- API 金鑰錯誤
- 網路問題
- 記憶體不足

---

## 🛡️ 安全建議

### **API 安全**

- ✅ 只開啟：讀取 + 交易權限
- ❌ 絕不開啟：提現權限
- ✅ 設置 IP 白名單
- ✅ 定期更換金鑰

### **檔案權限（Linux）**

```bash
chmod 600 .env        # 只有擁有者可讀
chmod 755 ~/crypto-bot
```

### **防火牆（Linux）**

```bash
sudo ufw enable
sudo ufw allow ssh
```

### **備份**

```bash
# 備份重要檔案
cp .env .env.backup
cp exchange_config.js exchange_config.backup.js
pm2 save
```

---

## 📊 效能監控

```bash
# PM2 監控
pm2 monit

# 清理日誌
pm2 flush

# 日誌輪替
pm2 install pm2-logrotate
```

---

## ⚠️ 免責聲明

本軟體僅供學習研究。加密貨幣交易有高風險，可能損失全部投資。使用前請：

1. 充分了解交易風險
2. 在測試環境測試
3. 自行承擔所有風險

**使用即表示同意自行承擔責任。**

---

## 🎉 快速開始

選擇您的系統：
- [Windows 安裝](#-windows-安裝)
- [Linux 安裝](#-linux-安裝)
- [手機安裝 (Android)](#-手機安裝-android)

祝您交易順利！💰📈
