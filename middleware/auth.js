function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  res.redirect('/admin/login');
}

// Only full admins (role === 'admin') can access this route
function requireSuperAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    const role = req.session.adminRole;
    if (!role || role === 'admin') return next();
    return res.status(403).send('<h2>Access Denied</h2><p>This page is restricted to administrators.</p><a href="/admin/dashboard">Back to Dashboard</a>');
  }
  req.session.returnTo = req.originalUrl;
  res.redirect('/admin/login');
}

function redirectIfLoggedIn(req, res, next) {
  if (req.session && req.session.adminId) {
    return res.redirect('/admin/dashboard');
  }
  next();
}

module.exports = { requireAdmin, requireSuperAdmin, redirectIfLoggedIn };
