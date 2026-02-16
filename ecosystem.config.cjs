module.exports = {
  apps: [
    {
      name: 'market-scanner',
      script: './market_scanner_multi.js',
      node_args: '--max-old-space-size=256',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      error_file: './logs/market-scanner-error.log',
      out_file: './logs/market-scanner-out.log',
      time: true
    },
    {
      name: 'trend-bot',
      script: './trend_bot_multi.js',
      node_args: '--max-old-space-size=512',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '600M',
      error_file: './logs/trend-bot-error.log',
      out_file: './logs/trend-bot-out.log',
      time: true
    },
    {
      name: 'grid-bot',
      script: './grid_bot_multi.js',
      node_args: '--max-old-space-size=512',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '600M',
      error_file: './logs/grid-bot-error.log',
      out_file: './logs/grid-bot-out.log',
      time: true
    }
  ]
};
