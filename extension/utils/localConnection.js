'use strict';

function distillLocalConnectionSnapshot({baseUrl = 'http://localhost:11434', model = 'qwen3:4b'} = {}) {
  return {baseUrl: String(baseUrl).trim().replace(/\/+$/, '').replace(/\/v1$/, ''), model:String(model).trim()};
}
function distillSameLocalConnection(a, b) {
  const left=distillLocalConnectionSnapshot(a), right=distillLocalConnectionSnapshot(b);
  return left.baseUrl === right.baseUrl && left.model === right.model;
}
if (typeof module !== 'undefined' && module.exports) module.exports = {distillLocalConnectionSnapshot,distillSameLocalConnection};
