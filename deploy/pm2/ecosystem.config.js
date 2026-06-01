// ════════════════════════════════════════════════════════════
// pm2 config para cristal-backend
// Uso: pm2 start /var/www/CristalBackend/deploy/pm2/ecosystem.config.js
// ════════════════════════════════════════════════════════════

module.exports = {
  apps: [{
    name: 'cristal-backend',
    cwd: '/var/www/CristalBackend',
    script: 'dist/index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '800M',
    env: {
      NODE_ENV: 'production',
    },
    error_file: '/var/log/pm2/cristal-backend-error.log',
    out_file: '/var/log/pm2/cristal-backend-out.log',
    merge_logs: true,
    time: true,
    kill_timeout: 5000,
  }],
};
