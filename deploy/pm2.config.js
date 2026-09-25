module.exports = {
  apps: [{
    name:         'empresas-api',
    script:       './backend/server.js',
    cwd:          '/var/www/empresas_ativas_brasil',
    instances:    2,
    exec_mode:    'cluster',
    watch:        false,
    env: {
      NODE_ENV:  'production',
      PORT:      3001,
    },
    error_file:   '/var/log/pm2/empresas-api-error.log',
    out_file:     '/var/log/pm2/empresas-api-out.log',
    time:         true,
    max_memory_restart: '500M',
    restart_delay: 3000,
  }],
};
