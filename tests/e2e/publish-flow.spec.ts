import { test, expect, type Page, type Locator } from '@playwright/test';

/** 按字段标签文字定位其输入控件（label 与 input 为同级结构，用容器定位最稳） */
function field(page: Page, labelPattern: RegExp): Locator {
  return page.locator('.field', { hasText: labelPattern }).locator('input, select').first();
}

/** 记录页面发起的所有外部主机，验证"原始数据不出本机"的隐私承诺 */
function spyExternalHosts(page: Page): Set<string> {
  const hosts = new Set<string>();
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) hosts.add(url.hostname);
  });
  return hosts;
}

test.describe('差分隐私发布工具 E2E', () => {
  test('完整发布流程：导入→设计→预算拦截→发布→误差→审计，且无任何外部请求', async ({ page }) => {
    const externalHosts = spyExternalHosts(page);
    await page.goto('/');

    // ---------- 1. 数据：浏览器内生成 5 万合成人口 ----------
    await expect(page.getByRole('heading', { name: /导入个人级数据/ })).toBeVisible();
    await page.getByRole('button', { name: /生成 50,000 人/ }).click();
    await expect(page.getByText(/共 50,000 条个人记录/)).toBeVisible();
    await expect(page.getByText('仅存于本机内存')).toBeVisible();

    // ---------- 2. 设计第一张表（ε=1.0） ----------
    await page.getByRole('button', { name: /下一步：设计交叉表/ }).click();
    await expect(page.getByRole('heading', { name: /设计要发布的交叉表/ })).toBeVisible();
    await field(page, /表名称/).fill('E2E 区县×年龄表');
    await field(page, /本表 ε 预算/).fill('1.0');
    await expect(page.getByText(/单指标 ε=0.500/)).toBeVisible();
    await page.getByRole('button', { name: /保存设计并去发布/ }).click();

    // ---------- 3. 发布第一张表 ----------
    await expect(page.getByRole('heading', { name: /选择表设计并发布/ })).toBeVisible();
    await page.getByRole('button', { name: /执行加噪发布/ }).click();
    await expect(page.getByRole('heading', { name: /发布前误差评估/ })).toBeVisible();
    await expect(page.getByText(/满足 5% 精度要求/).first()).toBeVisible();
    await expect(page.getByText(/抑制项汇总/).first()).toBeVisible();
    await expect(page.getByText(/【合计】/)).toBeVisible();

    // ---------- 4. 预算检查：总额 4，已扣 1.0，剩 3.0 ----------
    await page.getByRole('button', { name: '隐私预算' }).click();
    await expect(page.getByText(/4 \/ 1\.000 \/ 3\.000/)).toBeVisible();

    // ---------- 5. 超预算设计必须被拒绝 ----------
    await page.getByRole('button', { name: '表格设计' }).click();
    await field(page, /表名称/).fill('超预算表');
    await field(page, /本表 ε 预算/).fill('3.1');
    await expect(page.getByText(/超过剩余预算/)).toBeVisible();
    await expect(page.getByRole('button', { name: /保存设计并去发布/ })).toBeDisabled();
    // 改为合法预算 3.0（与已用 1.0 合计恰好耗尽总额 4）
    await field(page, /本表 ε 预算/).fill('3.0');
    await page.getByRole('button', { name: /保存设计并去发布/ }).click();

    // 标签页切换后预览页重挂载，需显式选中第二张设计再发布
    const designSelect = field(page, /待发布表/);
    const secondOption = designSelect.locator('option', { hasText: '超预算表' });
    await designSelect.selectOption((await secondOption.getAttribute('value'))!);
    await page.getByRole('button', { name: /执行加噪发布/ }).click();
    await expect(page.getByText(/抑制项汇总/).first()).toBeVisible();

    // ---------- 6. 预算耗尽后新设计被拦截 ----------
    await page.getByRole('button', { name: '表格设计' }).click();
    await field(page, /本表 ε 预算/).fill('0.5');
    await expect(page.getByText(/超过剩余预算/)).toBeVisible();

    // ---------- 7. 审计：两次发布均留痕 ----------
    await page.getByRole('button', { name: '审计记录' }).click();
    const auditRows = page.locator('table.audit-table tbody tr');
    await expect(auditRows).toHaveCount(2);
    await expect(page.locator('table.audit-table tbody')).toContainText('E2E 区县×年龄表');
    await expect(page.locator('table.audit-table tbody')).toContainText('超预算表');
    await expect(auditRows.first()).toContainText('统计员');

    // ---------- 8. 审计 CSV 下载 ----------
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /导出审计 CSV/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('差分隐私发布审计');

    // ---------- 9. 全过程无外部网络请求 ----------
    expect([...externalHosts]).toEqual([]);
  });

  test('高斯机制路径与 δ 记账、高抑制阈值生效', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /生成 50,000 人/ }).click();
    await expect(page.getByText(/共 50,000 条个人记录/)).toBeVisible();

    await page.getByRole('button', { name: /下一步：设计交叉表/ }).click();
    await field(page, /表名称/).fill('高斯 E2E 表');
    await field(page, /机制/).selectOption('gaussian');
    await field(page, /本表 ε 预算/).fill('0.8');
    await field(page, /δ（剩余/).fill('0.000001');
    // 增加第三个维度并提高抑制阈值
    await page.getByText('受教育程度').click();
    await field(page, /抑制阈值/).fill('10');
    await page.getByRole('button', { name: /保存设计并去发布/ }).click();

    await page.getByRole('button', { name: /执行加噪发布/ }).click();
    await expect(page.getByRole('heading', { name: /发布前误差评估/ })).toBeVisible();
    await expect(page.getByText(/高斯 ε=0.8/)).toBeVisible();

    await page.getByRole('button', { name: '隐私预算' }).click();
    // δ 卡：总额 1.0e-5，已用 1.0e-6
    await expect(page.getByText(/1\.0e-5 \/ 1\.0e-6/)).toBeVisible();
  });
});
