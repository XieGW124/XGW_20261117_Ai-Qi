'use strict';

const { test, expect } = require('@playwright/test');

test('用户可以在演示模式下提问并查看回答和记录', async ({ page }) => {
  const question = '什么是闭包？';

  await page.goto('/');

  await expect(page).toHaveTitle('AI 答疑助手');
  await expect(page.locator('#mode-badge')).toHaveText('演示模式（未配置密钥）');

  await page.getByLabel('你的问题').fill(question);
  await page.locator('#submit-btn').click();

  await expect(page.locator('#answer')).toBeVisible();
  await expect(page.locator('#answer-content')).toContainText('【演示模式】');
  await expect(page.locator('#answer-content')).toContainText(question);
  await expect(page.locator('#sources')).toContainText('1.2 闭包');
  await expect(page.locator('#history')).toContainText(question);
});
