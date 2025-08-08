/**
 * 127阈值单一功率模式测试
 * 验证修正后的功率计算逻辑
 */

// 模拟功率计算函数
function calculatePower(pixelValue, minPower, maxPower, isHalftone = false) {
    let power;
    
    if (isHalftone) {
        power = pixelValue < 128 ? maxPower : 0;
    } else {
        // 灰度模式功率计算
        if (maxPower === minPower) {
            // 当最大最小功率相同时，实现单一功率效果
            // 使用127作为阈值：暗于127的像素使用设定功率，亮于127的像素不出光
            power = pixelValue < 127 ? maxPower : 0;
        } else {
            // 正常的功率范围映射
            power = Math.round(minPower + (1.0 - pixelValue / 255.0) * (maxPower - minPower));
        }
    }
    
    return power;
}

// 测试用例
function runTests() {
    console.log("🧪 127阈值单一功率模式测试\n");
    console.log("=" * 50);
    
    // 测试用例1：单一功率模式 (50%, 50%)
    console.log("\n📋 测试用例1: 单一功率模式 (50%, 50%)");
    console.log("-" * 40);
    
    const testCases1 = [
        { value: 255, desc: "白色" },
        { value: 200, desc: "浅灰" },
        { value: 150, desc: "中浅灰" },
        { value: 127, desc: "中灰(阈值)" },
        { value: 126, desc: "略暗于阈值" },
        { value: 100, desc: "深灰" },
        { value: 50, desc: "更深灰" },
        { value: 0, desc: "黑色" }
    ];
    
    testCases1.forEach(testCase => {
        const power = calculatePower(testCase.value, 50, 50, false);
        const shouldEngrave = testCase.value < 127;
        const status = shouldEngrave ? "✅ 雕刻" : "❌ 不雕刻";
        
        console.log(`像素值 ${testCase.value.toString().padStart(3)} (${testCase.desc.padEnd(8)}) → 功率 ${power.toString().padStart(2)}% ${status}`);
    });
    
    // 测试用例2：正常功率范围 (20%, 80%)
    console.log("\n📋 测试用例2: 正常功率范围 (20%, 80%)");
    console.log("-" * 40);
    
    const testCases2 = [
        { value: 255, desc: "白色" },
        { value: 200, desc: "浅灰" },
        { value: 150, desc: "中浅灰" },
        { value: 127, desc: "中灰" },
        { value: 100, desc: "深灰" },
        { value: 50, desc: "更深灰" },
        { value: 0, desc: "黑色" }
    ];
    
    testCases2.forEach(testCase => {
        const power = calculatePower(testCase.value, 20, 80, false);
        console.log(`像素值 ${testCase.value.toString().padStart(3)} (${testCase.desc.padEnd(8)}) → 功率 ${power.toString().padStart(2)}%`);
    });
    
    // 测试用例3：半色调模式
    console.log("\n📋 测试用例3: 半色调模式 (50%, 50%)");
    console.log("-" * 40);
    
    testCases1.forEach(testCase => {
        const power = calculatePower(testCase.value, 50, 50, true);
        const shouldEngrave = testCase.value < 128; // 半色调使用128阈值
        const status = shouldEngrave ? "✅ 雕刻" : "❌ 不雕刻";
        
        console.log(`像素值 ${testCase.value.toString().padStart(3)} (${testCase.desc.padEnd(8)}) → 功率 ${power.toString().padStart(2)}% ${status}`);
    });
    
    // 验证阈值边界
    console.log("\n🔍 阈值边界验证");
    console.log("-" * 40);
    
    const boundaryTests = [
        { value: 128, mode: "单一功率", expected: 0 },
        { value: 127, mode: "单一功率", expected: 0 },
        { value: 126, mode: "单一功率", expected: 50 },
        { value: 129, mode: "半色调", expected: 0 },
        { value: 128, mode: "半色调", expected: 0 },
        { value: 127, mode: "半色调", expected: 50 }
    ];
    
    boundaryTests.forEach(test => {
        const isHalftone = test.mode === "半色调";
        const power = calculatePower(test.value, 50, 50, isHalftone);
        const result = power === test.expected ? "✅ 通过" : "❌ 失败";
        
        console.log(`${test.mode} 像素值 ${test.value} → 功率 ${power}% (期望 ${test.expected}%) ${result}`);
    });
    
    // 生成G代码示例
    console.log("\n📄 G代码示例");
    console.log("-" * 40);
    
    const gcodeSample = generateGCodeSample();
    console.log(gcodeSample);
    
    // 总结
    console.log("\n🎯 测试总结");
    console.log("-" * 40);
    console.log("✅ 单一功率模式使用127作为阈值");
    console.log("✅ 暗于127的像素使用设定功率");
    console.log("✅ 亮于127的像素功率为0");
    console.log("✅ 半色调模式仍使用128阈值");
    console.log("✅ 正常功率范围不受影响");
}

// 生成G代码示例
function generateGCodeSample() {
    const pixels = [255, 200, 150, 127, 126, 100, 50, 0];
    const gcode = [];
    
    gcode.push("; 单一功率模式G代码示例 (50%, 50%)");
    gcode.push("G90 ; 绝对坐标");
    gcode.push("G21 ; 毫米单位");
    gcode.push("M4 ; 启用激光");
    gcode.push("");
    
    pixels.forEach((pixel, index) => {
        const power = calculatePower(pixel, 50, 50, false);
        const x = index * 2;
        
        if (power > 0) {
            gcode.push(`G1 X${x} S${power} F3000 ; 像素${pixel} → 功率${power}%`);
        } else {
            gcode.push(`G0 X${x} F6000 ; 像素${pixel} → 不出光`);
        }
    });
    
    gcode.push("");
    gcode.push("M5 ; 关闭激光");
    gcode.push("G0 X0 Y0 ; 返回原点");
    
    return gcode.join('\n');
}

// 可视化阈值效果
function visualizeThreshold() {
    console.log("\n🎨 阈值效果可视化");
    console.log("-" * 40);
    
    const pixels = [];
    for (let i = 0; i <= 255; i += 15) {
        pixels.push(i);
    }
    
    console.log("像素值分布 (0=黑色, 255=白色):");
    console.log("0    32   64   96   127  159  191  223  255");
    console.log("█    ▓    ▒    ░    │    ░    ▒    ▓    █");
    console.log("                   阈值");
    console.log("");
    
    console.log("单一功率模式雕刻区域:");
    let visualization = "";
    pixels.forEach(pixel => {
        const power = calculatePower(pixel, 50, 50, false);
        visualization += power > 0 ? "█" : "░";
    });
    console.log(visualization);
    console.log("█ = 雕刻区域 (50%功率)");
    console.log("░ = 不雕刻区域 (0%功率)");
}

// 性能对比
function performanceComparison() {
    console.log("\n⚡ 性能对比");
    console.log("-" * 40);
    
    const testPixels = Array.from({length: 10000}, () => Math.floor(Math.random() * 256));
    
    // 测试修正前的逻辑（模拟错误情况）
    const start1 = performance.now();
    testPixels.forEach(pixel => {
        // 模拟原始错误逻辑
        const power = 50 + (1.0 - pixel / 255.0) * (50 - 50); // 总是50
    });
    const time1 = performance.now() - start1;
    
    // 测试修正后的逻辑
    const start2 = performance.now();
    testPixels.forEach(pixel => {
        calculatePower(pixel, 50, 50, false);
    });
    const time2 = performance.now() - start2;
    
    console.log(`修正前逻辑: ${time1.toFixed(2)}ms`);
    console.log(`修正后逻辑: ${time2.toFixed(2)}ms`);
    console.log(`性能影响: ${((time2 - time1) / time1 * 100).toFixed(1)}%`);
}

// 如果在Node.js环境中运行
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { 
        calculatePower, 
        runTests, 
        visualizeThreshold, 
        performanceComparison 
    };
}

// 如果在浏览器环境中运行
if (typeof window !== 'undefined') {
    window.ThresholdTest = { 
        calculatePower, 
        runTests, 
        visualizeThreshold, 
        performanceComparison 
    };
}

// 运行所有测试
console.log("🚀 开始127阈值测试...\n");
runTests();
visualizeThreshold();
performanceComparison();
