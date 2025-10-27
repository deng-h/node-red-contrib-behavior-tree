module.exports = function(RED) {
    "use strict";

    function BTRepeatNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // 配置参数
        node.repeat_count = config.repeatCount || 3;
        node.global_repeat_count = config.globalRepeatCount || "repeat_count";
        node.terminationCondition = config.terminationCondition || "fixed"; // 新增：终止条件 'fixed' | 'untilSuccess' | 'exitOnFailure'
        node.global_key = config.globalKey || "repeat_result";
        node.child_key = config.childKey || "child_result";
        node.check_interval = 300;

        // 状态变量
        node.timer = null;
        node.is_running = false;
        node.is_completed = false;
        node.current_count = 0;
        node.success_records = [];
        node.failure_records = [];

        node.status({ fill: "grey", shape: "dot", text: "就绪" });

        node.on('input', function(msg) {
            if (node.is_running) {
                node.warn("重复节点正在运行中，忽略新的输入");
                return;
            }

            node.is_running = true;
            node.is_completed = false;
            node.current_count = 0;
            node.success_records = [];
            node.failure_records = [];

            // 优先从全局变量获取重复次数
            try {
                const globalRepeatCount = node.context().global.get(node.global_repeat_count);
                if (globalRepeatCount !== undefined && globalRepeatCount !== null) {
                    const parsedCount = parseInt(globalRepeatCount, 10);
                    if (!isNaN(parsedCount) && parsedCount >= 0) {
                        node.repeat_count = parsedCount;
                    }
                }
            } catch (err) {
                node.warn(`获取全局重复次数失败: ${err.message}`);
            }

            if (0 == node.repeat_count)
                {
                    node.success_records.length = 1;
                    finishExecution("success");
                    return;
                }
            
            // 初始化全局状态
            node.context().global.set(node.global_key, {
                type: "repeat",
                status: "running",
                current_count: 0,
                total_count: node.repeat_count
            });

            node.context().global.set(node.child_key, "running");

            if (node.timer) {
                clearInterval(node.timer);
                node.timer = null;
            }

            node.status({ 
                fill: "yellow", 
                shape: "dot", 
                text: `执行第 ${node.current_count + 1}/${node.repeat_count} 次` 
            });

            const cur_msg = RED.util.cloneMessage(msg);
            executeChild(cur_msg); 
            node.timer = setInterval(() => check_child_state(cur_msg), node.check_interval);
        });

        function executeChild(msg) {
            if (!node.is_running || node.is_completed) return;
            
            node.current_count++;
            const child_msg = RED.util.cloneMessage(msg);
            child_msg.__repeat_count = node.current_count;
            node.send([child_msg]);
            
            node.context().global.set(node.global_key, {
                ...node.context().global.get(node.global_key),
                current_count: node.current_count,
                status: "running"
            });
            node.context().global.set(node.child_key, "running");
        }

        function check_child_state(msg) {
            if (!node.is_running || node.is_completed) return;

            const global_state = node.context().global.get(node.global_key) || {};
            const child_status = global_state.child_status;

            if (!child_status || child_status === "running") return;

            if (child_status === "success") {
                node.success_records.push(node.current_count);
            } else { // 'failure'
                node.failure_records.push(node.current_count);
            }
            
            // --- 核心逻辑修改 ---
            let should_continue = false;
            switch (node.terminationCondition) {
                case 'untilSuccess':
                    // 直到成功才停止
                    should_continue = (child_status !== "success");
                    break;
                case 'exitOnFailure':
                    // 失败即退出
                    should_continue = (child_status === "success") && (node.current_count < node.repeat_count);
                    break;
                case 'fixed':
                default:
                    // 固定次数
                    should_continue = (node.current_count < node.repeat_count);
                    break;
            }

            if (should_continue) {
                executeChild(msg);
                node.status({ 
                    fill: "yellow", 
                    shape: "dot", 
                    text: `执行第 ${node.current_count}/${node.repeat_count} 次` 
                });
            } else {
                finishExecution(child_status);
            }
        }

        function finishExecution(last_status) {
            node.is_completed = true;
            node.is_running = false;
            clearInterval(node.timer);
            node.timer = null;

            const final_status = node.terminationCondition === 'exitOnFailure'
                ? last_status // 如果是“失败即退出”模式，最终状态就是最后一次的状态（必然是失败）
                : (node.success_records.length > 0 ? "success" : "failure");

            node.context().global.set(node.global_key, {
                type: "repeat",
                status: final_status,
                total_count: node.repeat_count,
                success_count: node.success_records.length,
                failure_count: node.failure_records.length,
                success_records: node.success_records,
                failure_records: node.failure_records
            });
            
            node.context().global.set(node.child_key, final_status);

            const status_text = `${final_status}（共${node.repeat_count}次）` +
                               ` 成功: ${node.success_records.length}` +
                               ` 失败: ${node.failure_records.length}`;
            const status_color = final_status === "success" ? "green" : "red";
            node.status({ fill: status_color, shape: "dot", text: status_text });
        }

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

    RED.nodes.registerType('bt-repeat', BTRepeatNode);
};
