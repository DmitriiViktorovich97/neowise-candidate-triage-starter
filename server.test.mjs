import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "./server.mjs";

let server;
let baseUrl;

before(async () => {
    server = createAppServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
});

async function postTriage(body, raw = false) {
    const response = await fetch(`${baseUrl}/api/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: raw ? body : JSON.stringify(body),
    });
    return {
        status: response.status,
        data: await response.json(),
    };
}

describe("POST /api/triage", () => {
    it("возвращает 400 invalid_input при пустом, нестроковом вводе или битом JSON", async () => {
        for (const payload of [{}, { text: "" }, { text: "   " }, { text: 123 }, { text: null }]) {
            const res = await postTriage(payload);
            assert.equal(res.status, 400);
            assert.deepEqual(res.data, { status: "invalid_input" });
        }

        const brokenJsonRes = await postTriage("{broken-json", true);
        assert.equal(brokenJsonRes.status, 400);
        assert.deepEqual(brokenJsonRes.data, { status: "invalid_input" });
    });

    it("возвращает 200 ready при корректном ответе модели", async () => {
        const deliveryRes = await postTriage({ text: "Когда приедет доставка в Пермь?" });
        assert.equal(deliveryRes.status, 200);
        assert.equal(deliveryRes.data.status, "ready");
        assert.equal(deliveryRes.data.topic, "delivery");
        assert.ok(deliveryRes.data.draft.length > 0);

        const pricingRes = await postTriage({ text: "Какая стоимость оформления?" });
        assert.equal(pricingRes.status, 200);
        assert.equal(pricingRes.data.status, "ready");
        assert.equal(pricingRes.data.topic, "pricing");
        assert.ok(pricingRes.data.draft.length > 0);
    });


    it("переводит в manual_review при таймауте модели (> 300 мс)", async () => {
        const startedAt = Date.now();
        const res = await postTriage({ text: "Заявка с задержкой [timeout]" });
        const elapsed = Date.now() - startedAt;

        assert.equal(res.status, 200);
        assert.deepEqual(res.data, {
            status: "manual_review",
            topic: null,
            draft: null,
        });
        assert.ok(elapsed < 800, `Ожидалось прерывание по таймауту ~300 мс, заняло ${elapsed} мс`);
    });

    it("переводит в manual_review при ошибке провайдера, битом JSON, недопустимой теме и пустом черновике", async () => {
        const failureCases = [
            "Сбой провайдера [error]",
            "Кривой формат [bad-json]",
            "Неразрешенная тема [bad-topic]",
            "Пробелы вместо ответа [empty-draft]",
        ];

        for (const text of failureCases) {
            const res = await postTriage({ text });
            assert.equal(res.status, 200);
            assert.deepEqual(res.data, {
                status: "manual_review",
                topic: null,
                draft: null,
            });
        }
    });
});
