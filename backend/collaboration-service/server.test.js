const request = require('supertest');
const { app, server, io, redisClient } = require('./server');
const { io: Client } = require('socket.io-client');

// Mock Redis
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    on: jest.fn(),
    connect: jest.fn(() => Promise.resolve()),
    get: jest.fn(() => Promise.resolve(null)),
    set: jest.fn(() => Promise.resolve()),
    del: jest.fn(() => Promise.resolve()),
    getDel: jest.fn(() => Promise.resolve(null)),
    lRange: jest.fn(() => Promise.resolve([])),
    rPush: jest.fn(() => Promise.resolve()),
    sAdd: jest.fn(() => Promise.resolve()),
    sRem: jest.fn(() => Promise.resolve()),
    sCard: jest.fn(() => Promise.resolve(0)),
    duplicate: jest.fn(function() { return this; }),
    expire: jest.fn(() => Promise.resolve()),
    incr: jest.fn(() => Promise.resolve(1)),
    lTrim: jest.fn(() => Promise.resolve()),
  })),
}));

// Mock Socket.IO Redis Adapter
jest.mock('@socket.io/redis-adapter', () => ({
  createAdapter: jest.fn(),
}));

// Mock Axios
jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

describe('Collaboration Service REST API', () => {
  let sessionId = 'test-session';
  let userId = 'test-user';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /collab/session/:sessionId - unauthorized', async () => {
    const res = await request(app).get(`/collab/session/${sessionId}`);
    expect(res.status).toBe(401);
  });

  test('GET /collab/session/:sessionId - not found', async () => {
    redisClient.get.mockResolvedValue(null);
    const res = await request(app)
      .get(`/collab/session/${sessionId}`)
      .set('x-user-id', userId);
    expect(res.status).toBe(404);
  });

  test('GET /collab/active-session - no active session', async () => {
    redisClient.get.mockResolvedValue(null);
    const res = await request(app)
      .get('/collab/active-session')
      .set('x-user-id', userId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessionId: null });
  });

  test('POST /collab/join - success', async () => {
    const meta = { user1_id: userId, user2_id: 'other', questionId: 'q1' };
    redisClient.get.mockImplementation((key) => {
      if (key.includes(':meta')) return Promise.resolve(JSON.stringify(meta));
      return Promise.resolve(null);
    });
    const res = await request(app)
      .post('/collab/join')
      .set('x-user-id', userId)
      .send({ sessionId });
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ticket');
    expect(redisClient.set).toHaveBeenCalled();
  });
});

describe('Collaboration Service Socket.IO', () => {
  let httpServer;
  let clientSocket;
  let port;

  beforeAll((done) => {
    httpServer = server.listen(() => {
      port = httpServer.address().port;
      done();
    });
  });

  afterAll((done) => {
    httpServer.close();
    done();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach((done) => {
    if (clientSocket && clientSocket.connected) {
      clientSocket.disconnect();
    }
    done();
  });

  test('Socket.IO /editor namespace - connection requires ticket', (done) => {
    clientSocket = new Client(`http://localhost:${port}/editor`);
    clientSocket.on('connect_error', (err) => {
      expect(err.message).toBe('No ticket provided');
      done();
    });
  });

  test('Socket.IO /editor namespace - valid ticket', (done) => {
    const ticket = 'valid-ticket';
    const ticketData = { uid: 'user1', sessionId: 'session1' };
    
    redisClient.getDel.mockResolvedValue(JSON.stringify(ticketData));
    redisClient.get.mockResolvedValue(null); // for ended checks
    redisClient.lRange.mockResolvedValue([]); // for Yjs updates

    clientSocket = new Client(`http://localhost:${port}/editor`, {
      query: { ticket }
    });

    clientSocket.on('connect', () => {
      expect(clientSocket.connected).toBe(true);
      done();
    });
  });
});
