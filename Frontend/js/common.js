// common.js
// small utilities used by both pages

(function(global){
  // dynamic ws url: works when frontend served by same host:port as server
function wsUrl() {
  return "ws://127.0.0.1:8080"; 
}

  // short DOM helpers
  function el(id){ return document.getElementById(id); }

  // escape HTML for safety
  function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }

  // export
  global.APP = {
    wsUrl, el, escapeHtml
  };
})(window);
