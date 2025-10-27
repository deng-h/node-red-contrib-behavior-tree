/**
 * Node-RED 行为树重复节点模块
 * 实现行为树中的重复（Repeat）节点功能
 * @param {Object} RED - Node-RED 运行时对象
 */
module.exports = function(RED) {
    "use strict";

    /**
     * 行为树重复节点构造函数
     * @param {Object} config - 节点配置对象
     */
    return function BTRepeatNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // ==================== 配置参数 ====================
        /**
         * 默认重复次数
         * @type {number}
         * @default 3
         */
        node.repeat_count = config.repeatCount || 3;
        
        /**
         * 从全局变量获取重复次数的键名
         * 允许动态配置重复次数
         * @type {string}
         * @default "repeat_count"
         */
        node.global_repeat_count = config.globalRepeatCount || "repeat_count";
        
        /**
         * 终止条件类型
         * - fixed: 固定次数执行
         * - untilSuccess: 执行直到成功为止
         * - exitOnFailure: 遇到失败立即退出
         * @type {string}
         * @default "fixed"
         */
        node.terminationCondition = config.terminationCondition || "fixed";
        
        /**
         * 全局状态存储键名
         * 用于存储重复节点的执行状态
         * @type {string}
         * @default "repeat_result"
         */
        node.global_key = config.globalKey || "repeat_result";
        
        /**
         * 子节点状态存储键名
         * 用于与子节点通信
         * @type {string}
         * @default "child_result"
         */
        node.child_key = config.childKey || "child_result";
        
        /**
         * 检查子节点状态的时间间隔（毫秒）
         * @type {number}
         * @default 300
         */
        node.check_interval = 300;

        // ==================== 状态变量 ====================
        /**
         * 定时器句柄，用于定期检查子节点状态
         * @type {NodeJS.Timeout|null}
         */
        node.timer = null;
        
        /**
         * 节点是否正在运行
         * @type {boolean}
         */
        node.is_running = false;
        
        /**
         * 节点是否已完成执行
         * @type {boolean}
         */
        node.is_completed = false;
        
        /**
         * 当前执行次数计数器
         * @type {number}
         */
        node.current_count = 0;
        
        /**
         * 成功执行的次数记录数组
         * @type {number[]}
         */
        node.success_records = [];
        
        /**
         * 失败执行的次数记录数组
         * @type {number[]}
         */
        node.failure_records = [];

        // 初始化节点状态显示
        node.status({ fill: "grey", shape: "dot", text: "就绪" });

        /**
         * 处理输入消息的事件监听器
         * @param {Object} msg - 输入消息对象
         */
        node.on('input', function(msg) {
            // 防止重复执行：如果节点正在运行，忽略新的输入
            if (node.is_running) {
                node.warn("重复节点正在运行中，忽略新的输入");
                return;
            }

            // 重置节点状态，开始新的执行周期
            node.is_running = true;
            node.is_completed = false;
            node.current_count = 0;
            node.success_records = [];
            node.failure_records = [];

            // 优先从全局变量获取重复次数
            // 这允许在运行时动态调整重复次数
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

            // 特殊处理：如果重复次数为0，直接标记为成功并结束
            if (0 == node.repeat_count)
            {
                node.success_records.length = 1;
                finishExecution("success");
                return;
            }
            
            // 初始化全局状态对象
            node.context().global.set(node.global_key, {
                type: "repeat",
                status: "running",
                current_count: 0,
                total_count: node.repeat_count
            });

            // 设置子节点初始状态为运行中
            node.context().global.set(node.child_key, "running");

            // 清理可能存在的旧定时器
            if (node.timer) {
                clearInterval(node.timer);
                node.timer = null;
            }

            // 更新节点状态显示
            node.status({ 
                fill: "yellow", 
                shape: "dot", 
                text: `执行第 ${node.current_count + 1}/${node.repeat_count} 次` 
            });

            // 克隆消息并执行第一次子节点调用
            const cur_msg = RED.util.cloneMessage(msg);
            executeChild(cur_msg);
            
            // 启动定时器，定期检查子节点执行状态
            node.timer = setInterval(() => check_child_state(cur_msg), node.check_interval);
        });

        /**
         * 执行子节点
         * 向子节点发送消息并更新全局状态
         * @param {Object} msg - 要发送给子节点的消息对象
         */
        function executeChild(msg) {
            // 检查节点是否应该继续执行
            if (!node.is_running || node.is_completed) return;
            
            // 增加执行计数
            node.current_count++;
            
            // 克隆消息并附加当前执行次数信息
            const child_msg = RED.util.cloneMessage(msg);
            child_msg.__repeat_count = node.current_count;
            
            // 发送消息到子节点
            node.send([child_msg]);
            
            // 更新全局状态，记录当前执行次数
            node.context().global.set(node.global_key, {
                ...node.context().global.get(node.global_key),
                current_count: node.current_count,
                status: "running"
            });
            
            // 重置子节点状态为运行中
            node.context().global.set(node.child_key, "running");
        }

        /**
         * 检查子节点执行状态
         * 定期检查子节点是否完成，并根据终止条件决定是否继续执行
         * @param {Object} msg - 消息对象
         */
        function check_child_state(msg) {
            // 如果节点已停止或已完成，不再检查
            if (!node.is_running || node.is_completed) return;

            // 从全局状态获取子节点的执行状态
            const global_state = node.context().global.get(node.global_key) || {};
            const child_status = global_state.child_status;

            // 如果子节点还在运行中，继续等待
            if (!child_status || child_status === "running") return;

            // 记录本次执行结果
            if (child_status === "success") {
                node.success_records.push(node.current_count);
            } else { // 'failure'
                node.failure_records.push(node.current_count);
            }
            
            // ==================== 核心逻辑：根据终止条件判断是否继续执行 ====================
            let should_continue = false;
            switch (node.terminationCondition) {
                case 'untilSuccess':
                    // 模式1: 直到成功才停止
                    // 只要子节点没有成功，就继续重复执行
                    should_continue = (child_status !== "success");
                    break;
                    
                case 'exitOnFailure':
                    // 模式2: 遇到失败立即退出
                    // 只有在成功且未达到最大次数时才继续
                    should_continue = (child_status === "success") && (node.current_count < node.repeat_count);
                    break;
                    
                case 'fixed':
                default:
                    // 模式3: 固定次数执行（默认模式）
                    // 只要未达到指定次数就继续执行，无论成功失败
                    should_continue = (node.current_count < node.repeat_count);
                    break;
            }

            // 根据判断结果决定继续执行或结束
            if (should_continue) {
                // 继续执行下一次
                executeChild(msg);
                node.status({ 
                    fill: "yellow", 
                    shape: "dot", 
                    text: `执行第 ${node.current_count}/${node.repeat_count} 次` 
                });
            } else {
                // 达到终止条件，结束执行
                finishExecution(child_status);
            }
        }

        /**
         * 完成执行并设置最终状态
         * 清理定时器，更新全局状态，并显示最终结果
         * @param {string} last_status - 最后一次执行的状态（"success" 或 "failure"）
         */
        function finishExecution(last_status) {
            // 标记节点已完成并停止运行
            node.is_completed = true;
            node.is_running = false;
            
            // 清理定时器
            clearInterval(node.timer);
            node.timer = null;

            // 根据终止条件和执行记录确定最终状态
            const final_status = node.terminationCondition === 'exitOnFailure'
                ? last_status // "失败即退出"模式：最终状态取决于最后一次执行结果
                : (node.success_records.length > 0 ? "success" : "failure"); // 其他模式：只要有成功就算成功

            // 更新全局状态，记录完整的执行结果
            node.context().global.set(node.global_key, {
                type: "repeat",
                status: final_status,
                total_count: node.repeat_count,
                success_count: node.success_records.length,
                failure_count: node.failure_records.length,
                success_records: node.success_records,
                failure_records: node.failure_records
            });
            
            // 设置子节点状态键为最终状态
            node.context().global.set(node.child_key, final_status);

            // 构建状态显示文本
            const status_text = `${final_status}（共${node.repeat_count}次）` +
                               ` 成功: ${node.success_records.length}` +
                               ` 失败: ${node.failure_records.length}`;
            
            // 根据最终状态选择颜色（成功=绿色，失败=红色）
            const status_color = final_status === "success" ? "green" : "red";
            
            // 更新节点状态显示
            node.status({ fill: status_color, shape: "dot", text: status_text });
        }

        /**
         * 节点关闭事件处理器
         * 在节点被删除、重新部署或 Node-RED 关闭时调用
         * 负责清理资源和重置状态
         */
        node.on('close', function() {
            // 停止节点运行
            node.is_running = false;
            node.is_completed = true;
            
            // 清理定时器资源
            if (node.timer) {
                clearInterval(node.timer);
                node.timer = null;
            }
            
            // 清除状态显示
            node.status({});
        });
    }
};
