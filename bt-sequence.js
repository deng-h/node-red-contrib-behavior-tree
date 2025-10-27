module.exports = function(RED) {
    "use strict";

    function BTSequenceNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // 配置参数
        node.child_count = config.outputs;                          // 子节点数量
        node.global_key = config.globalKey || "sequence_result";    // 全局状态键名
        node.child_key = config.childKey || "child_result";         // 全局状态键名
        node.check_interval = 300;                                  // 状态检查间隔(ms)

        // 状态变量
        node.timer = null;
        node.is_running = false;
        node.is_completed = false;
        node.current_index = -1;                                    // 当前执行的子节点索引（-1表示未开始）
        node.child_status = new Array(node.child_count).fill("waiting");  // 子节点状态数组

        // 初始化节点状态
        node.status({ fill: "grey", shape: "dot", text: "就绪" });

        /**
         * 启动序列执行逻辑
         */
        node.on('input', function(msg) {
            // 重置状态
            node.is_running = true;
            node.is_completed = false;
            node.current_index = -1;
            node.child_status.fill("waiting");
            
            // 初始化全局状态
            node.context().global.set(node.global_key, {
                type: "sequence",
                status: "running",
                current_index: node.current_index,
                total_children: node.child_count,
                child_status:node.child_status
            });

            // 初始化子状态
            node.context().global.set(node.child_key, "running");

            // 清理旧定时器
            if (node.timer) {
                clearInterval(node.timer);
                node.timer = null;
            }

            // 立即执行第一个子节点
            const cur_msg = RED.util.cloneMessage(msg);
            executeNextChild(cur_msg);
            
            // 启动状态检查定时器
            node.timer = setInterval(() => check_child_state(cur_msg), node.check_interval);
        });

        /**
         * 执行下一个子节点
         */
        function executeNextChild(msg) {
            if (!node.is_running || node.is_completed) return;
            
            // 移动到下一个子节点索引
            node.current_index++;
            
            // 所有子节点执行完成
            if (node.current_index >= node.child_count) {
                finishExecution("success");
                return;
            }

            // 执行当前子节点
            const child_msg = RED.util.cloneMessage(msg);
            child_msg.__sequence_index = node.current_index;  // 传递当前子节点索引
            node.child_status[node.current_index] = "running";
            
            // 发送到对应索引的输出端口
            const output_msgs = Array(node.child_count).fill(null);
            output_msgs[node.current_index] = child_msg;
            node.send(output_msgs);
            
            // 更新节点状态
            node.status({ 
                fill: "yellow", 
                shape: "dot", 
                text: `执行子节点 ${node.current_index + 1}/${node.child_count}` 
            });

            // 更新全局状态
            node.context().global.set(node.global_key, {
                ...node.context().global.get(node.global_key),
                current_index: node.current_index,
                child_status: node.child_status,
                status: "running"
            });
            node.context().global.set(node.child_key, "running");
        }

        /**
         * 检查当前子节点执行状态
         */
        function check_child_state(msg) {
            if (!node.is_running || node.is_completed) return;
            if (node.current_index < 0 || node.current_index >= node.child_count) return;

            // 读取子节点状态
            const global_state = node.context().global.get(node.global_key) || {};
            const child_status = global_state.child_status[node.current_index];  // 子节点应设置此状态（success/failure）

            // 子节点未完成时不处理
            if (child_status !== "success" && child_status !== "failure") return;

            // 更新当前子节点状态记录
            node.child_status[node.current_index] = child_status;

            // 重置子节点状态，准备下一次检查
            node.context().global.set(node.global_key, {
                ...global_state,
                child_status: node.child_status
            });

            // 根据子节点结果决定下一步
            if (child_status === "success") {
                // 当前子节点成功，执行下一个
                executeNextChild(msg);
            } else {
                // 当前子节点失败，整体失败
                finishExecution("failure");
            }
        }

        /**
         * 完成序列执行
         */
        function finishExecution(final_status) {
            node.is_completed = true;
            node.is_running = false;
            clearInterval(node.timer);
            node.timer = null;

            // 统计成功/失败的子节点索引
            const success_indices = [];
            const failure_indices = [];
            node.child_status.forEach((state, index) => {
                if (state === "success") success_indices.push(index);
                if (state === "failure") failure_indices.push(index);
            });

            // 更新全局状态
            node.context().global.set(node.global_key, {
                type: "sequence",
                status: final_status,
                total_children: node.child_count,
                completed_children: node.current_index + 1,
                success_indices: success_indices,
                failure_indices: failure_indices,
                child_status: node.child_status
            });
            node.context().global.set(node.child_key, final_status);

            // 状态文本换行显示
            // const status_text = `${final_status}（共${node.child_count}个）` +
            //                    `成功: [${success_indices}] ` +
            //                    `失败: [${failure_indices}]`;
            let status_text = `${final_status}（共${node.child_count}个节点）`;
            if (failure_indices.length > 0) {
                status_text = status_text + `节点${failure_indices[0] + 1}失败`;
            }
            const status_color = final_status === "success" ? "green" : "red";
            node.status({ fill: status_color, shape: "dot", text: status_text });

            // 发送结果消息
            // node.send({
            //     status: final_status,
            //     total_children: node.child_count,
            //     completed_children: node.current_index + 1,
            //     success_indices: success_indices,
            //     failure_indices: failure_indices,
            //     child_status: node.child_status,
            //     status_text: status_text.replace(/<br>/g, "\n")
            // });
        }

        /**
         * 节点关闭时清理资源
         */
        node.on('close', function() {
            node.is_running = false;
            node.is_completed = true;
            if (node.timer) {
                clearInterval(node.timer);
                node.timer = null;
            }
            node.status({});
        });
    }

    // 注册节点类型
    RED.nodes.registerType('bt-sequence', BTSequenceNode);
};
