import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const app = express();
app.use(cors());
app.use(express.json());

// 简易注册
app.post('/api/register', async (req, res) => {
  try {
    const user = await prisma.user.create({ data: req.body });
    res.json(user);
  } catch (e) {
    res.status(400).json({ error: '用户名已存在' });
  }
});

// 登录接口
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    return res.status(400).json({ error: '用户不存在' });
  }
  if (user.password !== password) {
    return res.status(400).json({ error: '密码错误' });
  }
  res.json({ username: user.username, fullName: user.fullName });
});

// 测试用 GET
app.get('/api/hello', (_, res) => res.json({ msg: 'world' }));

app.listen(4000, () => console.log('Backend running → http://localhost:4000'));

app.get('/', (_, res) => {
  res.send('Backend is up and running 👍');
});

// /api/users?username=xxx 查询用户名是否存在
app.get('/api/users', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.json([]);
  const user = await prisma.user.findMany({ where: { username: String(username) } });
  res.json(user);
});

// /api/setWithdrawPwd 设置提现密码
app.post('/api/setWithdrawPwd', async (req, res) => {
  const { username, withdrawPwd } = req.body;
  if (!username || !withdrawPwd) return res.status(400).json({ error: '参数缺失' });
  console.log('setWithdrawPwd:', req.body);
  try {
    const user = await prisma.user.update({
      where: { username },
      data: { withdrawPwd }
    });
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'P2025') {
      // Prisma: Record not found
      res.status(404).json({ error: '用户不存在' });
    } else {
      res.status(500).json({ error: '保存失败', detail: e.message });
    }
  }
});

app.post('/api/addWithdrawMethod', async (req, res) => {
  const { username, bankName, accountName, accountNumber } = req.body;
  if (!username || !bankName || !accountName || !accountNumber) {
    return res.status(400).json({ error: '参数缺失' });
  }
  try {
    // 直接更新 User 表
    const user = await prisma.user.update({
      where: { username },
      data: {
        bankName,
        bankAccountName: accountName,
        bankAccount: accountNumber,
      }
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '保存失败', detail: e.message });
  }
});

// 查询用户收款账号信息
app.get('/api/getWithdrawAccounts', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.json([]);
  // 假设你的 user 表有 bankName、bankAccountName、bankAccount 字段
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.bankName || !user.bankAccountName || !user.bankAccount) {
    return res.json([]);
  }
  res.json([
    {
      bankName: user.bankName,
      accountName: user.bankAccountName,
      accountNumber: user.bankAccount,
    }
  ]);
});

// 检查用户是否已设置提现密码和完整银行信息
app.get('/api/checkWithdrawReady', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ ready: false });
  const user = await prisma.user.findUnique({ where: { username } });
  if (
    user &&
    user.withdrawPwd &&
    user.bankName &&
    user.bankAccountName &&
    user.bankAccount
  ) {
    res.json({ ready: true });
  } else {
    res.json({ ready: false });
  }
});

// /api/checkWithdrawPwd
app.post('/api/checkWithdrawPwd', async (req, res) => {
  const { username, withdrawPwd } = req.body;
  if (!username || !withdrawPwd) return res.json({ ok: false });
  const user = await prisma.user.findUnique({ where: { username } });
  if (user && user.withdrawPwd === withdrawPwd) {
    res.json({ ok: true });
  } else {
    res.json({ ok: false });
  }
});

// 新增：获取用户信息（会员姓名等）
app.get('/api/userinfo', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: '缺少用户名' });
  const user = await prisma.user.findUnique({ where: { username: String(username) } });
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json({ fullName: user.fullName, username: user.username });
});

