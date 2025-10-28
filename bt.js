/**
 * 行为树节点包主入口文件
 * Behavior Tree Nodes for Node-RED
 */
module.exports = function (RED) {
  require('./bt-repeat')(RED);
  require('./bt-sequence')(RED);
  require('./bt-parallel')(RED);
  require('./bt-sleep')(RED);
};
