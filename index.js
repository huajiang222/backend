import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();

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
  res.json({ username: user.username, fullName: user.fullName });
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

  const transactions = await prisma.transaction.findMany({
    where: conditions,
    skip: (page - 1) * pageSize,
    take: parseInt(pageSize),
    orderBy: { createdAt: 'desc' },
    include: { user: true }
  });

  res.json(transactions);
});

// 审核充值提现记录
app.patch('/api/transactions/:id', async (req, res) => {
  const { status, reviewBy, remark } = req.body;
  const id = parseInt(req.params.id);

  try {
    const transaction = await prisma.transaction.findUnique({ where: { id } });
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

      if (status === 'approved') {
        const user = await tx.user.findUnique({ where: { id: transaction.userId } });

        if (transaction.type === 'deposit') {
          await tx.user.update({
            where: { id: user.id },
            data: { points: user.points + Number(transaction.amount) }
          });
        } else if (transaction.type === 'withdraw') {
          await tx.user.update({
            where: { id: user.id },
            data: { points: user.points - Number(transaction.amount) }
          });
        }
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
  if (!username) return res.json([]);
  const users = await prisma.user.findMany({ where: { username } });
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

app.get('/', (_, res) => res.send('Backend is up and running 👍'));
app.listen(4000, () => console.log('Backend running → http://localhost:4000'));
