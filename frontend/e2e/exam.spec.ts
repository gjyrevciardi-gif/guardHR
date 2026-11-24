import { expect, test } from "@playwright/test";

const WEB = process.env.E2E_WEB_URL ?? "http://localhost:3100";
const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8100/api";
const EMAIL = process.env.E2E_EMAIL ?? "hr@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "ChangeMe123!";

// One end-to-end path through everything that matters at once: the host's API, the candidate's exam page (notice, hidden
// questions, blocked copy, recorded paste, submit), the database, and what the host reads back afterwards.
test("a candidate sits an exam and the host sees the score and the signals", async ({ page, request }) => {
  const login = await request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD }, headers: { Origin: WEB } });
  expect(login.ok(), "the host account from the CI seed or your dev database").toBeTruthy();
  const host = { Origin: WEB, Authorization: `Bearer ${(await login.json()).access_token}` };

  const created = await request.post(`${API}/tests`, {
    headers: host,
    data: {
      title: "Smoke exam",
      description: null,
      form_mode: false,
      is_public: true,
      questions: [
        { question_type: "multiple_choice", prompt: "What is 2 + 2?", options: ["Three", "Four"], correct_option_index: 1 },
        { question_type: "short_text", prompt: "Explain why the sky is blue", options: [], correct_option_index: null },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const exam = await created.json();

  try {
    await page.goto(`/forms/${exam.public_token}`);
    await expect(page.getByRole("heading", { name: "Para se të nisësh" })).toBeVisible();
    await expect(page.getByText("What is 2 + 2?")).toHaveCount(0); // not in the page until the candidate starts

    const start = page.getByRole("button", { name: "Fillo testin" });
    await page.locator("#form-name").fill("Smoke Candidate");
    await page.locator("#form-email").fill("smoke@example.com");
    await expect(start).toBeDisabled(); // not until the notice is accepted
    await page.getByRole("checkbox").check();
    await start.click();

    await expect(page.getByText("What is 2 + 2?")).toBeVisible();
    await expect(page.locator('div.fixed[aria-hidden="true"]')).toBeVisible(); // the watermark

    const copyBlocked = await page.evaluate(() => {
      const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(copyBlocked).toBe(true);

    await page.waitForTimeout(1100); // the guard ignores a second event of the same kind inside one second
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "def secret():\n  return 42");
      document.querySelector("textarea")?.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    });

    await page.getByText("Four").click();
    await page.locator("textarea").fill("Rayleigh scattering");
    await page.getByRole("button", { name: "Dorëzo testin" }).click();
    await expect(page.getByText("Testi u dorëzua")).toBeVisible();

    const detail = await request.get(`${API}/tests/${exam.id}`, { headers: host });
    const [submission] = (await detail.json()).standalone_submissions;
    expect(submission).toMatchObject({ participant_name: "Smoke Candidate", participant_email: "smoke@example.com", score: 1, total: 1 });
    const signals = submission.events.map((event: { metadata: { operation?: string }; severity: string }) => [event.metadata.operation, event.severity]);
    expect(signals).toEqual(expect.arrayContaining([["copy", "low"], ["paste", "medium"]]));
    expect(JSON.stringify(submission.events)).not.toContain("def secret"); // lengths are kept, never the text
  } finally {
    await request.delete(`${API}/tests/${exam.id}`, { headers: host });
  }
});
