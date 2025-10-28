module.exports = function(RED) {
    function BTSleepNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // 保存配置参数
        node.delayTime = config.delayTime || 2000; // 延迟时间(毫秒)
        node.countdownInterval = null; // 倒计时定时器
        node.global_key = config.globalKey || "delay_time";    // 全局状态键名
        node.remainingTime = 0; // 剩余时间(毫秒)
        
        // 处理输入消息
        node.on('input', function(msg) {
            // 清除现有定时器
            if (node.countdownInterval) {
                clearInterval(node.countdownInterval);
            }
            
            if (node.delayTimer) {
                clearTimeout(node.delayTimer);
            }

            if (node.context().global.get(node.global_key) !== undefined && node.context().global.get(node.global_key) !== null)
            {
                node.delayTime = node.context().global.get(node.global_key);
            }
            
            // 初始化倒计时
            node.remainingTime = node.delayTime;
            const msgCopy = RED.util.cloneMessage(msg);
            
            // 显示初始状态
            node.status({
                fill: "orange",
                shape: "ring",
                text: `剩余: ${Math.ceil(node.remainingTime / 1000)}秒`
            });
            
            // 启动倒计时定时器(每秒更新一次)
            node.countdownInterval = setInterval(function() {
                node.remainingTime -= 1000;
                if (node.remainingTime <= 0) {
                    node.remainingTime = 0;
                }
                // 更新剩余时间显示
                node.status({
                    fill: "orange",
                    shape: "ring",
                    text: `剩余: ${Math.ceil(node.remainingTime / 1000)}秒`
                });
            }, 1000);
            
            // 启动延迟定时器
            node.delayTimer = setTimeout(function() {
                // 清除倒计时定时器
                clearInterval(node.countdownInterval);
                node.countdownInterval = null;
                
                // 处理消息并输出
                msgCopy.payload = `延时${node.delayTime / 1000}s`;
                node.send(msgCopy);
                
                // 更新完成状态
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: "延时结束"
                });
            }, node.delayTime);
        });
        
        // 节点关闭时清理资源
        node.on('close', function() {
            if (node.countdownInterval) {
                clearInterval(node.countdownInterval);
            }
            if (node.delayTimer) {
                clearTimeout(node.delayTimer);
            }
            node.status({}); // 清除状态显示
        });
    }
    
    RED.nodes.registerType("bt-sleep", BTSleepNode);
};
