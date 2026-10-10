const timeToMinutes = (t) => {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  return h * 60 + m;
};

module.exports = { timeToMinutes };