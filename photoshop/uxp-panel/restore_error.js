'use strict';

/*
 * UXP/Photoshop errors can be strings, platform objects, or even undefined.
 * Do not let a missing `message` hide where restoration stopped.
 */
function describeUxPFailure(error) {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    for (const key of ['message','_message','error','reason','code','number']) {
      const value = error[key];
      if (typeof value === 'string' && value.trim()) return value;
      if (typeof value === 'number') return key + ': ' + value;
    }
    try {
      const data = JSON.stringify(error);
      if (typeof data === 'string' && data !== '{}') return data.slice(0, 450);
    } catch (_) {}
    try {
      const s = String(error);
      if (s && s !== '[object Object]') return s;
    } catch (_) {}
    return '詳細なし（Photoshopからのオブジェクト例外）';
  }
  return error === undefined
    ? '詳細なし（Photoshopからundefinedが返されました）'
    : error === null ? '詳細なし（null）' : String(error);
}

function restoreFailureMessage(stage, error) {
  const step = typeof stage === 'string' && stage.trim() ? stage : '不明な工程';
  return 'LaTeXへの復元を中断しました。元のレイヤーは保持されています。'
    + '\n停止箇所: ' + step + '\n原因: ' + describeUxPFailure(error);
}
module.exports = {describeUxPFailure, restoreFailureMessage};
