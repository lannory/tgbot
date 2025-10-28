module.exports = {
  apps: [
    {
      name: "backend",
      script: "server.js",
      cwd: "/root/tgbot/server",
      interpreter: "node",
      node_args: "--experimental-specifier-resolution=node",
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};