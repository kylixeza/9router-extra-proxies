'use strict';

document.addEventListener('DOMContentLoaded', () => {
  handleHash();
  reload();
  reloadProjects().then(() => {
    reloadLogs();
    reloadUsage();
  });

  setInterval(reload, 2000);
  setInterval(reloadUsage, 5000);
  setInterval(() => {
    if (page === 1) reloadLogs();
  }, 5000);
});
