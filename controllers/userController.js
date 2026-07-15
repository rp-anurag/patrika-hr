'use strict';
const { Admin, Department, Position } = require('../models');
const bcrypt = require('bcryptjs');

exports.listUsers = async (req, res) => {
  try {
    const [users, deptRows, posRows] = await Promise.all([
      Admin.findAll({ order: [['createdAt', 'DESC']], attributes: { exclude: ['password'] } }),
      Department.findAll({ order: [['name', 'ASC']] }),
      Position.findAll({ where: { isActive: true }, order: [['sortOrder','ASC'],['name','ASC']] })
    ]);
    const allDepts     = deptRows.map(d => d.name);
    const allPositions = posRows.map(p => p.name);
    res.render('admin/users', {
      title:           'User Management – Patrika HR',
      adminName:       req.session.adminName,
      adminRole:       req.session.adminRole,
      adminDepartment: req.session.adminDepartment,
      users,
      allDepts,
      allPositions,
      v: res.locals.v
    });
  } catch (err) {
    console.error('listUsers error:', err);
    res.status(500).send('Server error: ' + err.message);
  }
};

exports.createUser = async (req, res) => {
  try {
    const { username, password, name, role, departments, positions } = req.body;
    if (!username || !password || !name) return res.status(400).json({ error: 'username, password, name are required' });
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const deptArr = Array.isArray(departments) ? departments.filter(Boolean) : (departments ? [departments] : []);
    const posArr  = Array.isArray(positions)   ? positions.filter(Boolean)   : (positions   ? [positions]   : []);
    if (role === 'user' && deptArr.length === 0 && posArr.length === 0)
      return res.status(400).json({ error: 'Select at least one department or position for user role' });
    const existing = await Admin.findOne({ where: { username } });
    if (existing) return res.status(409).json({ error: 'Username already exists' });
    const user = await Admin.create({
      username, password, name, role,
      department: role === 'user' ? deptArr : [],
      positions:  role === 'user' ? posArr  : [],
    });
    res.json({ success: true, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
  } catch (err) {
    console.error('createUser error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const user = await Admin.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { name, password, role, departments, positions } = req.body;
    const newRole = role || user.role;
    const deptArr = Array.isArray(departments) ? departments.filter(Boolean) : (departments ? [departments] : []);
    const posArr  = Array.isArray(positions)   ? positions.filter(Boolean)   : (positions   ? [positions]   : []);
    const updates = {
      name:       name || user.name,
      role:       newRole,
      department: newRole === 'user' ? deptArr : [],
      positions:  newRole === 'user' ? posArr  : [],
    };
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
