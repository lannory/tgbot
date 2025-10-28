module.exports = {
  apps: [
    {
      name: "backend",
      script: "./server.js",
      cwd: "/root/tgbot/server",
      interpreter: "node",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 3000
      }
    },
    {
      name: "bot",
      script: "./script.js",
      cwd: "/root/tgbot/client",
      interpreter: "node",
      watch: false,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
}