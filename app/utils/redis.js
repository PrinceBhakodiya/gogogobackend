const Redis = require('redis');
const redisClient = Redis.createClient({
  socket: { // <-- notice `socket` for redis v4+
    host: 'redis-12933.crce179.ap-south-1-1.ec2.redns.redis-cloud.com',
    port: 12933,
    reconnectStrategy: retries => {
      console.log('Reconnecting to Redis...', retries);
      return Math.min(retries * 100, 3000); // retry delay
    }
  },
  password: 'UDXrH8vZAIMMGaUIP60FHFmPj6sOaQGL',
  lazyConnect: true
});

redisClient.on('error', err => console.error('Redis Error:', err));
redisClient.on('connect', () => console.log('Redis Connected'));

redisClient.connect().catch(err => console.error('Connect Failed:', err));

module.exports = redisClient;
