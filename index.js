import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import multer from "multer";
import path from "path";

const prisma = new PrismaClient();
const app = express();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    // 保留原始扩展名
    const ext = path.extname(file.originalname);
    const basename = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, basename + ext);
  }
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());

// 用户注册
app.post('/api/register', async (req, res) => {
  try {
    const user = await prisma.user.create({ data: req.body });
    res.json(user);
  } catch (e) {
    res.status(400).json({ error: '用户名已存在' });
  }
});

// 用户登录
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || user.password !== password) {
    return res.status(400).json({ error: '用户名或密码错误' });
  }
  updateUserActive(user.id, user.username);
  res.json({ id: user.id, username: user.username, fullName: user.fullName }); // 返回id
});

// 创建充值或提现记录
app.post('/api/transactions', async (req, res) => {
  let { userId, type, amount, orderNo, bankName, bankAccount, bankAccountName, proofUrl, remark } = req.body;
  try {
    // 强制转换 amount 为字符串数字
    amount = amount ? amount.toString() : "0";
    const transaction = await prisma.transaction.create({
      data: {
        userId,
        type,
        amount,
        orderNo,
        bankName,
        bankAccount,
        bankAccountName,
        proofUrl,
        remark,
        status: 'pending'
      }
    });
    res.json(transaction);
  } catch (e) {
    res.status(400).json({ error: '创建记录失败', detail: e.message });
  }
});

// 获取充值提现记录列表
app.get('/api/transactions', async (req, res) => {
  const { type, status, userId, page = 1, pageSize = 20 } = req.query;
  const conditions = {};
  if (type) conditions.type = type;
  if (status) conditions.status = status;
  if (userId) conditions.userId = parseInt(userId);

  try {
    const transactions = await prisma.transaction.findMany({
      where: conditions,
      skip: (page - 1) * pageSize,
      take: parseInt(pageSize),
      orderBy: { createdAt: 'desc' },
      include: { user: true }
    });
    res.json(transactions);
  } catch (e) {
    res.status(500).json({ error: '查询失败', detail: e.message });
  }
});

// 审核充值提现记录
app.patch('/api/transactions/:id', async (req, res) => {
  const { status, reviewBy, remark, points } = req.body;
  const id = parseInt(req.params.id);

  try {
    const transaction = await prisma.transaction.findUnique({ where: { id }, include: { user: true } });
    if (!transaction || transaction.status !== 'pending') {
      return res.status(400).json({ error: '记录不存在或已审核' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id },
        data: {
          status,
          reviewBy,
          reviewTime: new Date(),
          remark
        }
      });

      // 审核通过时同步点数
      if (status === 'approved') {
        let newPoints = transaction.user.points;
        const syncValue = points !== undefined ? Number(points) : Number(transaction.amount);
        if (transaction.type === 'deposit') {
          newPoints += syncValue;
        } else if (transaction.type === 'withdraw') {
          // 校验余额
          if (syncValue > newPoints) {
            throw new Error('提现金额不能大于当前点数');
          }
          newPoints -= syncValue;
          if (newPoints < 0) newPoints = 0;
        }
        await tx.user.update({
          where: { id: transaction.userId },
          data: { points: newPoints }
        });
      }
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '审核失败', detail: e.message });
  }
});

// 获取单个用户所有交易记录
app.get('/api/users/:userId/transactions', async (req, res) => {
  const { userId } = req.params;
  const { page = 1, pageSize = 10 } = req.query;

  const transactions = await prisma.transaction.findMany({
    where: { userId: parseInt(userId) },
    skip: (page - 1) * pageSize,
    take: parseInt(pageSize),
    orderBy: { createdAt: 'desc' }
  });

  res.json(transactions);
});

// 设置提现密码
app.post('/api/setWithdrawPwd', async (req, res) => {
  const { username, withdrawPwd } = req.body;
  try {
    await prisma.user.update({
      where: { username },
      data: { withdrawPwd }
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '保存失败', detail: e.message });
  }
});

// 添加提现银行账户信息
app.post('/api/addWithdrawMethod', async (req, res) => {
  const { username, bankName, accountName, accountNumber } = req.body;
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return res.status(404).json({ error: '用户不存在' });
  try {
    await prisma.withdrawMethod.create({
      data: {
        userId: user.id,
        bankName,
        accountName,
        accountNumber
      }
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '保存失败', detail: e.message });
  }
});

// 获取用户信息（支持通过用户名查询）
app.get('/api/users', async (req, res) => {
  const { username } = req.query;
  let users;
  if (username) {
    users = await prisma.user.findMany({
      where: { username },
      include: { withdrawMethods: true }
    });
  } else {
    users = await prisma.user.findMany({
      include: { withdrawMethods: true }
    });
  }
  res.json(users);
});

// 检查用户是否已设置提现密码和至少一个提现银行卡
app.get('/api/checkWithdrawReady', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ ready: false });
  const user = await prisma.user.findUnique({
    where: { username },
    include: { withdrawMethods: true }
  });
  if (!user) return res.json({ ready: false });
  // 判断条件：有提现密码且有至少一个银行卡
  const ready = !!user.withdrawPwd && user.withdrawMethods.length > 0;
  res.json({ ready });
});

app.post('/api/checkWithdrawPwd', async (req, res) => {
  const { username, withdrawPwd } = req.body;
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || user.withdrawPwd !== withdrawPwd) {
    return res.json({ ok: false });
  }
  res.json({ ok: true });
});

app.get('/api/getWithdrawAccounts', async (req, res) => {
  const { username } = req.query;
  const user = await prisma.user.findUnique({
    where: { username },
    include: { withdrawMethods: true }
  });
  if (!user) return res.json([]);
  res.json(user.withdrawMethods);
});

app.get('/api/userinfo', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({});
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return res.json({});
  res.json({ username: user.username, fullName: user.fullName });
});

app.get('/api/my-transactions', async (req, res) => {
  const { userId, page = 1, pageSize = 20 } = req.query;
  if (!userId) return res.json([]);
  const transactions = await prisma.transaction.findMany({
    where: { userId: parseInt(userId) },
    skip: (page - 1) * pageSize,
    take: parseInt(pageSize),
    orderBy: { createdAt: 'desc' }
  });
  res.json(transactions);
});

// 文件上传接口
app.post("/api/upload", upload.single("file"), (req, res) => {
  // 假设静态资源目录为 /uploads
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

// 静态资源托管
app.use("/uploads", express.static("uploads"));

// 在线用户结构示例
let onlineUsers = []; // 确保有这个全局变量

// 用户每次有操作时
function updateUserActive(userId, username) {
  const now = Date.now();
  const idx = onlineUsers.findIndex(u => u.id === userId);
  if (idx > -1) {
    onlineUsers[idx].lastActive = now;
  } else {
    onlineUsers.push({ id: userId, username, lastActive: now });
  }
}

// 定时清理离线用户（如5分钟无操作）
setInterval(() => {
  const now = Date.now();
  onlineUsers = onlineUsers.filter(u => now - u.lastActive < 30 * 60 * 1000);
}, 60 * 1000);

// 提供接口
app.get('/api/onlineUsers', (req, res) => {
  res.json(onlineUsers);
});

app.post('/api/logout', (req, res) => {
  const { userId } = req.body;
  console.log("logout api called, userId:", userId, "onlineUsers:", onlineUsers);
  if (!userId) return res.status(400).json({ error: "缺少userId" });
  onlineUsers = onlineUsers.filter(u => String(u.id) !== String(userId));
  res.json({ success: true });
});

app.get('/', (_, res) => res.send('Backend is up and running 👍'));
app.listen(4000, () => console.log('Backend running → http://localhost:4000'));
