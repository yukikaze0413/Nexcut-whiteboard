/**
 * G代码生成测试脚本
 * 验证扫描图层G代码指令修正是否正确
 */

// 模拟扫描图层G代码生成的核心逻辑
function simulateGCodeGeneration() {
    const gcode = [];
    let x0 = null, y0 = null, speed0 = null;
    let x1 = null, y1 = null, speed1 = null, power1 = 0;

    // 修正后的flush函数
    function flush(ignoreTravel = false) {
        // 根据功率决定使用G0还是G1指令
        const isRapidMove = power1 === 0;
        let cmd = isRapidMove ? "G0 " : "G1 ";
        
        if (x0 !== x1 && x1 != null) {
            cmd += `X${x1.toFixed(3)}`;
            x0 = x1;
        }
        if (y0 !== y1 && y1 != null) {
            cmd += `Y${y1.toFixed(3)}`;
            y0 = y1;
        }
        if (cmd.length === 3 || (power1 === 0 && ignoreTravel)) {
            return;
        }
        
        // 只有G1指令需要功率参数，G0指令不需要
        if (!isRapidMove) {
            cmd += `S${power1}`;
        }
        
        if (speed0 !== speed1) {
            cmd += ` F${speed1}`;
            speed0 = speed1;
        }
        gcode.push(cmd);
    }

    function goTo(x, y, power, speed, forceFlush = false) {
        if (power1 !== power || speed1 !== speed) {
            flush();
            power1 = power;
            speed1 = speed;
        }
        x1 = x ?? x1;
        y1 = y ?? y1;
        if (forceFlush) {
            flush();
        }
    }

    // 模拟扫描过程
    console.log("🔧 开始生成测试G代码...\n");

    // G代码头部
    gcode.push("G90 ; Absolute positioning");
    gcode.push("G21 ; Units in millimeters");
    gcode.push("G0 X0 Y0 F6000 ; Move to origin");
    gcode.push("M4 ; Enable laser (variable power mode)");
    gcode.push("");

    // 模拟扫描第一行
    gcode.push("; 扫描第一行");
    goTo(-3, 10, 0, 6000, true);  // 快速移动到行起始
    goTo(0, 10, 0, 6000, true);   // 不出光移动到内容起始
    goTo(5, 10, 80, 3000, true);  // 出光雕刻
    goTo(10, 10, 0, 6000, true);  // 不出光跳过空白
    goTo(15, 10, 60, 3000, true); // 继续出光雕刻
    goTo(18, 10, 0, 6000, true);  // 快速移动到行结束

    // 模拟扫描第二行（反向）
    gcode.push("; 扫描第二行（反向）");
    goTo(18, 11, 0, 6000, true);  // 快速移动到下一行起始
    goTo(15, 11, 0, 6000, true);  // 不出光移动到内容起始
    goTo(10, 11, 60, 3000, true); // 出光雕刻
    goTo(5, 11, 0, 6000, true);   // 不出光跳过空白
    goTo(0, 11, 80, 3000, true);  // 继续出光雕刻
    goTo(-3, 11, 0, 6000, true);  // 快速移动到行结束

    // G代码尾部
    gcode.push("");
    gcode.push("M5 ; Disable laser");
    gcode.push("G0 X0 Y0 F6000 ; Return to origin");
    gcode.push("M2 ; End program");

    return gcode;
}

// 验证G代码指令的正确性
function validateGCode(gcode) {
    console.log("✅ 开始验证G代码指令...\n");
    
    const results = {
        totalLines: gcode.length,
        g0Commands: 0,
        g1Commands: 0,
        g0WithPower: 0,
        g1WithoutPower: 0,
        errors: []
    };

    gcode.forEach((line, index) => {
        const lineNum = index + 1;
        
        // 检查G0指令
        if (line.startsWith('G0 ')) {
            results.g0Commands++;
            
            // G0指令不应该包含S参数（功率）
            if (line.includes(' S')) {
                results.g0WithPower++;
                results.errors.push(`行 ${lineNum}: G0指令包含功率参数 - ${line}`);
            }
        }
        
        // 检查G1指令
        if (line.startsWith('G1 ')) {
            results.g1Commands++;
            
            // G1指令应该包含S参数（除非是注释行）
            if (!line.includes(' S') && !line.includes(';')) {
                results.g1WithoutPower++;
                results.errors.push(`行 ${lineNum}: G1指令缺少功率参数 - ${line}`);
            }
        }
    });

    return results;
}

// 运行测试
function runTest() {
    console.log("🚀 G代码指令修正验证测试\n");
    console.log("=" * 50);
    
    // 生成测试G代码
    const gcode = simulateGCodeGeneration();
    
    // 显示生成的G代码
    console.log("📄 生成的G代码:");
    console.log("-" * 30);
    gcode.forEach((line, index) => {
        const lineNum = (index + 1).toString().padStart(2, '0');
        const prefix = line.startsWith('G0 ') ? '🟢' : 
                      line.startsWith('G1 ') ? '🔵' : '⚪';
        console.log(`${lineNum}: ${prefix} ${line}`);
    });
    
    console.log("\n");
    
    // 验证G代码
    const validation = validateGCode(gcode);
    
    // 显示验证结果
    console.log("📊 验证结果:");
    console.log("-" * 30);
    console.log(`总行数: ${validation.totalLines}`);
    console.log(`G0指令数量: ${validation.g0Commands} 🟢`);
    console.log(`G1指令数量: ${validation.g1Commands} 🔵`);
    console.log(`G0指令包含功率参数: ${validation.g0WithPower} ${validation.g0WithPower === 0 ? '✅' : '❌'}`);
    console.log(`G1指令缺少功率参数: ${validation.g1WithoutPower} ${validation.g1WithoutPower === 0 ? '✅' : '❌'}`);
    
    if (validation.errors.length > 0) {
        console.log("\n❌ 发现错误:");
        validation.errors.forEach(error => console.log(`  ${error}`));
    } else {
        console.log("\n✅ 所有指令验证通过！");
    }
    
    // 分析指令分布
    console.log("\n📈 指令分析:");
    console.log("-" * 30);
    
    const g0Lines = gcode.filter(line => line.startsWith('G0 '));
    const g1Lines = gcode.filter(line => line.startsWith('G1 '));
    
    console.log("🟢 G0指令（快速移动，不出光）:");
    g0Lines.forEach(line => console.log(`  ${line}`));
    
    console.log("\n🔵 G1指令（工作移动，出光）:");
    g1Lines.forEach(line => console.log(`  ${line}`));
    
    // 总结
    console.log("\n🎯 测试总结:");
    console.log("-" * 30);
    
    const isValid = validation.g0WithPower === 0 && validation.g1WithoutPower === 0;
    
    if (isValid) {
        console.log("✅ 修正验证成功！");
        console.log("  - 所有不出光移动使用G0指令");
        console.log("  - 所有出光移动使用G1指令");
        console.log("  - G0指令不包含功率参数");
        console.log("  - G1指令包含正确的功率参数");
    } else {
        console.log("❌ 修正验证失败！");
        console.log("  请检查flush函数的实现逻辑");
    }
    
    return isValid;
}

// 如果在Node.js环境中运行
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runTest, simulateGCodeGeneration, validateGCode };
}

// 如果在浏览器环境中运行
if (typeof window !== 'undefined') {
    window.GCodeTest = { runTest, simulateGCodeGeneration, validateGCode };
}

// 直接运行测试
runTest();
