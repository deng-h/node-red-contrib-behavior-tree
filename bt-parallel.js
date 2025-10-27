module.exports = function(RED) {
    "use strict";

    function BTParallelNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // 配置参数
        node.child_count = config.outputs;                              // 子节点数量
        node.completion_type = config.completionType || "all_success";  // 完成条件
        node.global_key = config.globalKey || "parallel_result";        // 全局状态键名
        node.child_key = config.childKey || "child_result";         // 全局状态键名
        node.check_interval = 500;                                      // 状态检查间隔(ms)

        // 状态变量
        node.timer = null;
        node.is_running = false;
        node.is_completed = false;
        node.child_status = new Array(node.child_count).fill("waiting");    // 子节点状态数组
        node.active_children = 0;                                           // 活跃子节点数量

        // 初始化节点状态
        node.status({ fill: "grey", shape: "dot", text: "就绪" });

        /**
         * 启动并行逻辑
         */
        node.on('input', function(msg) {
            // 重置状态
            node.is_running = true;
            node.is_completed = false;
            node.child_status.fill("waiting");
            node.active_children = 0;
            node.context().global.set(node.global_key, {
                type: "parallel",
                status: "running",
                child_status: node.child_status
            });

            // 初始化子状态
            node.context().global.set(node.child_key, "running");

            // 清理旧定时器
            if (node.timer) {
                clearInterval(node.timer);
                node.timer = null;
            }

            // 同时启动所有子节点
            const cur_msg = RED.util.cloneMessage(msg);
            const output_msgs = Array(node.child_count).fill(null);
            node.child_status.forEach((_, index) => {
                output_msgs[index] = RED.util.cloneMessage(cur_msg);
                output_msgs[index].__parallel_index = index; // 子节点索引
                node.child_status[index] = "running";
                node.active_children++;
            });
            node.send(output_msgs);
            node.status({ fill: "yellow", shape: "dot", text: `并行执行 ${node.child_count} 个子节点` });

            // 启动状态检查定时器
            node.timer = setInterval(() => check_child_status(), node.check_interval);
        });

        /**
         * 检查子节点状态并判断完成条件
         */
        function check_child_status() {
            if (!node.is_running || node.is_completed) return;

            // 读取全局状态
            const global_state = node.context().global.get(node.global_key) || {};
            if (global_state.child_status) {
                node.child_status = global_state.child_status;
            }

            // 统计成功/失败的子节点索引
            const success_indices = []; // 成功的子节点索引（如 [0, 2]）
            const failure_indices = []; // 失败的子节点索引（如 [1]）
            node.child_status.forEach((state, index) => {
                if (state === "success") success_indices.push(index);
                if (state === "failure") failure_indices.push(index);
            });
            const success_count = success_indices.length;
            const failure_count = failure_indices.length;
            node.active_children = node.child_status.filter(s => s === "running").length;

            // 判断完成条件
            let is_complete = false;
            let final_status = "failure";

            switch (node.completion_type) {
                case "all_success":
                    if (failure_count > 0) {
                        is_complete = true;
                        final_status = "failure";
                    } else if (success_count === node.child_count) {
                        is_complete = true;
                        final_status = "success";
                    }
                    break;

                case "any_success":
                    if (success_count > 0) {
                        is_complete = true;
                        final_status = "success";
                    } else if (failure_count === node.child_count) {
                        is_complete = true;
                        final_status = "failure";
                    }
                    break;

                case "all_complete":
                    if (success_count + failure_count === node.child_count) {
                        is_complete = true;
                        final_status = success_count > 0 ? "success" : "failure";
                    }
                    break;
            }

            // 满足条件时结束
            if (is_complete) {
                node.is_completed = true;
                node.is_running = false;
                clearInterval(node.timer);
                node.timer = null;

                // 更新全局状态
                node.context().global.set(node.global_key, {
                    type: "parallel",
                    status: final_status,
                    child_status: node.child_status
                });

                // 初始化子状态
                node.context().global.set(node.child_key, final_status);

                // 更新节点状态文本（显示具体成功/失败的节点索引）
                const status_text = `${final_status}（共${node.child_count}个）成功节点: [${success_indices}]失败节点: [${failure_indices}]`;
                const status_color = final_status === "success" ? "green" : "red";
                node.status({ fill: status_color, shape: "dot", text: status_text });
            }
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
    RED.nodes.registerType('bt-parallel', BTParallelNode);
};
