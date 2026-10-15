/* Reject an accidentally running RaTeX/Node bridge before modifying a PSD. */
'use strict';
const BACKEND_ID = 'python-latex-fonttools-v1';
function assertBackend(response) {
  if (!response || response.ok !== true || response.backend !== BACKEND_ID) {
    const actual = response && typeof response.backend === 'string'
      ? response.backend : '識別子なし';
    throw new Error(
      '接続先のサーバー識別子が一致しません（' + actual + '）。' +
      'Node版とは限らず、旧版のPythonサーバーが応答している場合もあります。' +
      'ポート8765のプロセスを確認し、その起動元を確かめてから停止してください。' +
      'その後、start_inline_math.cmd で最新版Pythonサーバーを起動してください。'
    );
  }
  return response;
}
module.exports = { BACKEND_ID, assertBackend };
