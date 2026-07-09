'use strict';
const { Admin, Department } = require('../models');
const bcrypt = require('bcryptjs');

exports.listUsers = async (req, res) => {
  try {
    const [users, deptRows] = await Promise.all([
      Admin.findAll({ order: [['createdAt', 'DESC']], attributes: { exclude: ['password'] } }),
      Department.findAll({ order: [['name', 'ASC']] })
    ]);
    const allDepts = deptRows.map(d => d.name);
    res.render('admin/users', {
      title:           'User Management – Patrika HR',
      adminName:       req.session.adminName,
      adminRole:       req.session.adminRole,
      adminDepartment: req.session.adminDepartment,
      users,
      allDepts,
      v: res.locals.v
    });
  } catch (err) {
    console.error('listUsers error:', err);
    res.status(500).send('Server error: ' + err.message);
  }
};

exports.createUser = async (req, res) => {
  try {
    const { username, password, name, role, departments } = req.body;
    if (!username || !password || !name) return res.status(400).json({ error: 'username, password, name are required' });
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const deptArr = Array.isArray(departments) ? departments.filter(Boolean) : (departments ? [departments] : []);
    if (role === 'user' && deptArr.length === 0) return res.status(400).json({ error: 'At least one department is required for user role' });
    const existing = await Admin.findOne({ where: { username } });
    if (existing) return res.status(409).json({ error: 'Username already exists' });
    const user = await Admin.create({ username, password, name, role, department: role === 'user' ? deptArr : [] });
    res.json({ success: true, user: { id: user.id, username: user.username, name: user.name, role: user.role, department: user.department } });
  } catch (err) {
    console.error('createUser error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const user = await Admin.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { name, password, role, departments } = req.body;
    const updates = { name: name || user.name, role: role || user.role };
    const deptArr = Array.isArray(departments) ? departments.filter(Boolean) : (departments ? [departments] : []);
    updates.department = (updates.role === 'user') ? deptArr : [];
    if (password && password.trim()) updates.password = password.trim();
    await user.update(updates);
    res.json({ success: true });
  } catch (err) {
    console.error('updateUser error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const user = await Admin.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (String(req.params.id) === String(req.session.adminId)) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    await user.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('deleteUser error:', err);
    res.status(500).json({ error: err.message });
  }
};
