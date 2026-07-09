const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const bcrypt = require('bcryptjs');

const Admin = sequelize.define('Admin', {
  id:        { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  username:  { type: DataTypes.STRING(100), allowNull: false, unique: true },
  password:  { type: DataTypes.STRING(255), allowNull: false },
  name:       { type: DataTypes.STRING(255), defaultValue: 'Admin' },
  role:       { type: DataTypes.STRING(20),  defaultValue: 'admin' },
  department: {
    type: DataTypes.TEXT,
    defaultValue: null,
    get() {
      const v = this.getDataValue('department');
      if (!v) return [];
      try { return JSON.parse(v); } catch { return [v]; }
    },
    set(val) {
      if (!val || (Array.isArray(val) && val.length === 0)) {
        this.setDataValue('department', null);
      } else {
        this.setDataValue('department', JSON.stringify(Array.isArray(val) ? val : [val]));
      }
    }
  },
  createdAt:  { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'admins',
  timestamps: false,
  hooks: {
    beforeCreate: async (admin) => {
      admin.password = await bcrypt.hash(admin.password, 12);
    },
    beforeUpdate: async (admin) => {
      if (admin.changed('password')) {
        admin.password = await bcrypt.hash(admin.password, 12);
      }
    }
  }
});

Admin.prototype.comparePassword = async function (plainPassword) {
  return bcrypt.compare(plainPassword, this.password);
};

module.exports = Admin;
