import { createServer } from "node:net";
import { APIRequestContext, expect, test } from "@playwright/test";

const WEB = process.env.E2E_WEB_URL ?? "http://localhost:3100";
const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8100/api";
const EMAIL = process.env.E2E_EMAIL ?? "hr@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "ChangeMe123!";
// The API must send its mail here (SMTP_HOST=127.0.0.1, SMTP_PORT=this): CI sets it, and the README says how to do it locally.
const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 2525);

// One login for the whole run: the API allows ten logins per account every fifteen minutes, and every test needs the host.
let hostHeaders: Promise<Record<string, string>> | undefined;
function loginHost(request: APIRequestContext) {
  hostHeaders ??= request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD }, headers: { Origin: WEB } }).then(async (login) => {
    expect(login.ok(), "the host account from the CI seed or your dev database").toBeTruthy();
    return { Origin: WEB, Authorization: `Bearer ${(await login.json()).access_token}` };
  });
  return hostHeaders;
}

// One end-to-end path through everything that matters at once: the host's API, the candidate's exam page (notice, hidden
// questions, blocked copy, recorded paste, submit), the database, and what the host reads back afterwards.
test("a candidate sits an exam and the host sees the score and the signals", async ({ page, request }) => {
  const host = await loginHost(request);

  const created = await request.post(`${API}/tests`, {
    headers: host,
    data: {
      title: "Smoke exam",
      description: null,
      form_mode: false,
      is_public: true,
      time_limit_minutes: 30,
      shuffle: true, // the answers must still be scored against the host's key, whatever order the candidate saw
      questions: [
        { question_type: "multiple_choice", prompt: "What is 2 + 2?", options: ["Three", "Four"], correct_option_index: 1 },
        { question_type: "short_text", prompt: "Explain why the sky is blue", options: [], correct_option_index: null },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const exam = await created.json();

  try {
    const link = await request.get(`${API}/public/tests/${exam.public_token}`);
    expect((await link.json()).questions).toEqual([]); // the link alone carries no questions, only the server's start step does

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
    await expect(page.getByRole("timer")).toBeVisible(); // the test has a time limit

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
    const { standalone_submissions: [submission], unfinished_attempts: unfinished } = await detail.json();
    expect(submission).toMatchObject({ participant_name: "Smoke Candidate", participant_email: "smoke@example.com", score: 1, total: 1, over_limit_seconds: null });
    expect(submission.duration_seconds).toBeGreaterThanOrEqual(0);
    expect(unfinished).toEqual([]); // starting and then submitting leaves nobody unfinished
    const signals = submission.events.map((event: { metadata: { operation?: string }; severity: string }) => [event.metadata.operation, event.severity]);
    expect(signals).toEqual(expect.arrayContaining([["copy", "low"], ["paste", "medium"]]));
    expect(JSON.stringify(submission.events)).not.toContain("def secret"); // lengths are kept, never the text
  } finally {
    await request.delete(`${API}/tests/${exam.id}`, { headers: host });
  }
});

// The countdown runs on the server's seconds-left, and at zero the page sends what has been answered. Playwright's fake
// clock moves the page past the limit without waiting a real minute.
test("when the time runs out the page submits what the candidate has answered", async ({ page, request }) => {
  const host = await loginHost(request);
  const created = await request.post(`${API}/tests`, {
    headers: host,
    data: {
      title: "Timed exam",
      description: null,
      form_mode: false,
      is_public: true,
      time_limit_minutes: 1,
      questions: [{ question_type: "multiple_choice", prompt: "What is 2 + 2?", options: ["Three", "Four"], correct_option_index: 1 }, { question_type: "short_text", prompt: "Say why", options: [], correct_option_index: null }],
    },
  });
  const exam = await created.json();

  try {
    await page.clock.install();
    await page.goto(`/forms/${exam.public_token}`);
    await page.locator("#form-name").fill("Slow Candidate");
    await page.locator("#form-email").fill("slow@example.com");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Fillo testin" }).click();
    await expect(page.getByRole("timer")).toBeVisible();

    await page.getByText("Four").click(); // one of two questions answered; the second stays empty
    await page.clock.fastForward("01:05");
    await expect(page.getByText("Testi u dorëzua")).toBeVisible();

    const detail = await request.get(`${API}/tests/${exam.id}`, { headers: host });
    const [submission] = (await detail.json()).standalone_submissions;
    expect(submission).toMatchObject({ participant_email: "slow@example.com", score: 1, total: 1 });
    expect(Object.keys(submission.answers)).toHaveLength(1); // only what had been answered
  } finally {
    await request.delete(`${API}/tests/${exam.id}`, { headers: host });
  }
});

// A refresh or a crash mid-exam: starting again with the same email picks the attempt up (same order) and the tab's saved
// answers come back, so nothing typed is lost. The draft is dropped once the exam is submitted.
test("a refresh in the middle of an exam keeps the order and the answers", async ({ page, request }) => {
  const host = await loginHost(request);
  const created = await request.post(`${API}/tests`, {
    headers: host,
    data: {
      title: "Refresh exam",
      description: null,
      form_mode: false,
      is_public: true,
      time_limit_minutes: 30,
      shuffle: true,
      questions: [
        ...[1, 2, 3].map((n) => ({ question_type: "multiple_choice", prompt: `Question ${n}`, options: [`Alpha ${n}`, `Beta ${n}`], correct_option_index: 0 })),
        { question_type: "short_text", prompt: "Say why", options: [], correct_option_index: null },
      ],
    },
  });
  const exam = await created.json();

  async function startExam() {
    await page.goto(`/forms/${exam.public_token}`);
    await page.locator("#form-name").fill("Refresh Candidate");
    await page.locator("#form-email").fill("refresh@example.com");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Fillo testin" }).click();
    await expect(page.getByRole("timer")).toBeVisible();
  }

  try {
    await startExam();
    const order = await page.locator("p[id^=q-]").allTextContents();
    await page.getByText("Beta 1").click();
    await page.getByText("Alpha 3").click();
    await page.locator("textarea").fill("half a thought");

    await startExam(); // the page is loaded again from scratch, as after a refresh or a crash
    expect(await page.locator("p[id^=q-]").allTextContents()).toEqual(order); // the server's order for this attempt
    await expect(page.getByRole("radio", { name: "Beta 1" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Alpha 3" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Alpha 2" })).not.toBeChecked();
    await expect(page.locator("textarea")).toHaveValue("half a thought");

    await page.getByText("Alpha 2").click();
    await page.getByRole("button", { name: "Dorëzo testin" }).click();
    await expect(page.getByText("Testi u dorëzua")).toBeVisible();
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("ng-exam-draft-")))).toEqual([]);

    const detail = await request.get(`${API}/tests/${exam.id}`, { headers: host });
    const [submission] = (await detail.json()).standalone_submissions;
    expect(submission).toMatchObject({ participant_email: "refresh@example.com", score: 2, total: 3 }); // Alpha 2 and Alpha 3 are right, Beta 1 is not, whatever order was shown
  } finally {
    await request.delete(`${API}/tests/${exam.id}`, { headers: host });
  }
});

// A just-enough SMTP server: it answers the API's mail client and keeps what it was sent, so the test can read the code.
function mailSink() {
  const mails: string[] = [];
  const server = createServer((socket) => {
    let buffer = "";
    let inData = false;
    socket.write("220 sink ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          mails.push(buffer.slice(0, end));
          buffer = buffer.slice(end + 5);
          inData = false;
          socket.write("250 queued\r\n");
        } else {
          const eol = buffer.indexOf("\r\n");
          if (eol === -1) return;
          const verb = buffer.slice(0, 4).toUpperCase();
          buffer = buffer.slice(eol + 2);
          if (verb === "DATA") {
            inData = true;
            socket.write("354 go ahead\r\n");
          } else if (verb === "QUIT") {
            socket.end("221 bye\r\n");
          } else {
            socket.write("250 ok\r\n");
          }
        }
      }
    });
  });
  return new Promise<{ mails: string[]; close: () => void }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(SMTP_PORT, "127.0.0.1", () => resolve({ mails, close: () => server.close() }));
  });
}

// A test that checks email: the questions are not handed out until the code that was emailed to the candidate is typed in.
test("a test that checks email hands out its questions only after the emailed code", async ({ page, request }) => {
  const host = await loginHost(request);
  const sink = await mailSink();
  const created = await request.post(`${API}/tests`, {
    headers: host,
    data: {
      title: "Checked exam",
      description: null,
      form_mode: false,
      is_public: true,
      verify_candidate_email: true,
      questions: [{ question_type: "multiple_choice", prompt: "What is 2 + 2?", options: ["Three", "Four"], correct_option_index: 1 }],
    },
  });
  expect(created.status()).toBe(201);
  const exam = await created.json();

  try {
    const bypass = await request.post(`${API}/public/tests/${exam.public_token}/start`, { data: { participant_name: "Sneaky", participant_email: "sneaky@example.com" } });
    expect(bypass.status()).toBe(403); // the plain start is closed for a test that checks email

    await page.goto(`/forms/${exam.public_token}`);
    await page.locator("#form-name").fill("Checked Candidate");
    await page.locator("#form-email").fill("checked@example.com");
    await expect(page.getByRole("button", { name: "Dërgo kodin" })).toHaveCount(0); // not until the notice is accepted
    await page.getByRole("checkbox").check();
    await expect(page.getByRole("button", { name: "Fillo testin" })).toHaveCount(0); // there is no way to start without the code
    await page.getByRole("button", { name: "Dërgo kodin" }).click();

    await expect.poll(() => sink.mails.length, { message: "the code email reaches the mail server" }).toBe(1);
    expect(sink.mails[0]).toContain("To: checked@example.com");
    const code = sink.mails[0].match(/Subject: Kodi i verifikimit NemoGuardHR: (\d{6})/)?.[1];
    expect(code).toBeTruthy();
    await expect(page.locator("#form-email")).toHaveJSProperty("readOnly", true); // the code belongs to this address
    await expect(page.getByText("What is 2 + 2?")).toHaveCount(0);

    const wrong = code === "000000" ? "111111" : "000000";
    await page.locator("#verification-code").fill(wrong);
    await page.getByRole("button", { name: "Verifiko", exact: true }).click();
    await expect(page.locator("#verification-error")).toContainText("Kodi nuk është i saktë"); // not getByRole("alert"): the route announcer is one too
    await expect(page.getByText("What is 2 + 2?")).toHaveCount(0);

    await page.locator("#verification-code").fill(code!);
    await page.getByRole("button", { name: "Verifiko", exact: true }).click();
    await expect(page.getByText("What is 2 + 2?")).toBeVisible();
    await expect(page.locator('div.fixed[aria-hidden="true"]')).toBeVisible(); // the watermark carries the verified address

    await page.getByText("Four").click();
    await page.getByRole("button", { name: "Dorëzo testin" }).click();
    await expect(page.getByText("Testi u dorëzua")).toBeVisible();

    const detail = await request.get(`${API}/tests/${exam.id}`, { headers: host });
    const { standalone_submissions: [submission] } = await detail.json();
    expect(submission).toMatchObject({ participant_email: "checked@example.com", score: 1, total: 1 });
    expect(submission.email_verified_at).toBeTruthy();
  } finally {
    sink.close();
    await request.delete(`${API}/tests/${exam.id}`, { headers: host });
  }
});
