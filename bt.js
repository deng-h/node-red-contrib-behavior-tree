/**
 * 行为树节点包主入口文件
 * Behavior Tree Nodes for Node-RED
 */
module.exports = function (RED) {
  var BtRepeatNode = require('./bt-repeat')(RED);
  var BtSequenceNode = require('./bt-sequence')(RED);
  var BtParallelNode = require('./bt-parallel')(RED);
  var BtSleepNode = require('./bt-sleep')(RED);

  RED.nodes.registerType("bt-repeat", BtRepeatNode);
  RED.nodes.registerType("bt-sequence", BtSequenceNode);
  RED.nodes.registerType("bt-parallel", BtParallelNode);
  RED.nodes.registerType("bt-sleep", BtSleepNode);
};
