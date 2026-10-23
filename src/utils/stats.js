// 按 createdAt 的日期统计每天的提问数量，返回“日期 → 次数”的对象
function countQuestionsByDay(records) {
    const stats = {};
    records.forEach(record => {
        const date = record.createdAt.toISOString().slice(0,10);
        stats[date] = (stats[date] || 0) + 1;
    });
    return stats;
}

