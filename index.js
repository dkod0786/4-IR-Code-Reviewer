import dotenv from "dotenv";
import { App } from "octokit";
import { createNodeMiddleware } from "@octokit/webhooks";
import fs from "fs";
import http from "http";
import { VertexAI } from "@google-cloud/vertexai";

dotenv.config();

const appId = process.env.APP_ID;
const webhookSecret = process.env.WEBHOOK_SECRET;
const privateKeyPath = process.env.PRIVATE_KEY_PATH;

const privateKey = fs.readFileSync(privateKeyPath, "utf8");

const app = new App({
  appId: appId,
  privateKey: privateKey,
  webhooks: {
    secret: webhookSecret,
  },
});

const vertex_ai = new VertexAI({
  project: "syy-eag-np-61cd",
  location: "us-central1",
});
const model = "gemini-1.5-flash-001";

const generativeModel = vertex_ai.preview.getGenerativeModel({
  model: model,
  generationConfig: {
    maxOutputTokens: 8192,
    temperature: 1.0,
    topP: 0.95,
  },
  safetySettings: [
    {
      category: "HARM_CATEGORY_HATE_SPEECH",
      threshold: "BLOCK_MEDIUM_AND_ABOVE",
    },
    {
      category: "HARM_CATEGORY_DANGEROUS_CONTENT",
      threshold: "BLOCK_MEDIUM_AND_ABOVE",
    },
    {
      category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
      threshold: "BLOCK_MEDIUM_AND_ABOVE",
    },
    {
      category: "HARM_CATEGORY_HARASSMENT",
      threshold: "BLOCK_MEDIUM_AND_ABOVE",
    },
  ],
});

async function generateContent(codeDiff) {
  const req = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `
Code Review AI Prompt

Persona

You are an AI specializing in code reviewing, adept at identifying specific errors, deviations from best practices, and violations of industry standards, language-specific guidelines, and SOLID principles.

Context

You are tasked with reviewing a GitHub pull request diff. This review is crucial for maintaining high code quality, ensuring adherence to best practices, and upholding the integrity of the project.

Task

Review the provided GitHub pull request diff thoroughly. Your objectives are to:

Identify any errors, defects, or deviations from best practices in the code changes.
Provide detailed review comments for each identified issue.
Instructions

For each identified issue, provide a detailed review comment that includes:

1. The exact file name and line number(s) where the issue is present.
2. A clear description of the issue, explaining why it is considered an error or a deviation from best practices.
3. The specific code snippet where the issue occurs.
4. Specific recommendations or suggestions on how to resolve the issue, following industry standards, language-specific best practices, SOLID principles and DRY (if applicable).
5. If the issue is related to a violation of SOLID principles, explicitly mention which principle(s) is being violated and provide an explanation.
6. If the issue is related to a deviation from industry or language-specific best practices, cite the relevant best practice or guideline being violated.
7. Prioritize the identified issues based on their severity and potential impact on code quality, maintainability, and performance.

Provide an overall assessment of the code changes, highlighting any major concerns or areas that require significant improvement. If there are no issues found, explicitly state that the code changes adhere to best practices and industry standards.

Exemplar

Here is an example of how your review should be structured:

Issue

1. Lack of Validation on Request Body

File: src/main/java/com/sysco/productservice/controller/ProductController.java
Line: 20, 27, 33, 39, 45, 52, 60
Code Snippet:
java
@PostMapping("/products")
public ResponseEntity<Product> createProduct(@RequestBody ProductDTO productDTO) {
    // No validation annotations here
    Product product = productService.createProduct(productDTO);
    return ResponseEntity.status(HttpStatus.CREATED).body(product);
}
Issue: The ProductController lacks validation on the ProductDTO object passed in the request body for all methods except createProduct. This could lead to unexpected errors or data inconsistencies in the database.
Recommendation: Use @Validated annotation on the ProductDTO parameter for all methods to leverage Spring's built-in validation capabilities.
Best Practice: Validate request bodies to ensure data integrity and prevent errors during data processing.
Overall Assessment

While the code exhibits a good starting point for a product service, it requires several improvements in validation, query specificity, error handling, testing, and resource management. Addressing these issues will lead to a more robust and well-structured microservice.

Format

Please follow this structure for your review:

Issues

1. [Issue Description]

File: [File Path]
Line: [Line Numbers]
Code Snippet:
java
Copy code
[Code Snippet]
Issue: [Detailed Issue Description]
Recommendation: [Specific Recommendation]
Best Practice: [Relevant Best Practice]
Overall Assessment

[Overall Assessment]

Tone

Your tone should be professional, clear, and constructive. Focus on providing actionable feedback that helps developers understand and implement the recommended changes effectively.

Review the following code diff:

${codeDiff}

`,
          },
        ],
      },
    ],
  };

  const result = await generativeModel.generateContent(req);
  const response = result.response;
  const textContent = response?.candidates[0]?.content.parts[0]?.text;
  return textContent;
}

async function handleGettingCodeDiff({ octokit, payload }) {
  console.log(
    `Received a pull request event for #${payload.pull_request.number}`
  );

  try {
    const pullRequestDiffResponse = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        pull_number: payload.pull_request.number,
        mediaType: {
          format: "diff",
        },
        headers: {
          "x-github-api-version": "2022-11-28",
        },
      }
    );
    console.log("Received Pull Request Diff");
    const pullRequestDiff = pullRequestDiffResponse?.data;

    const messageForPR = await generateContent(pullRequestDiff);
    console.log("Message Generated");
    try {
      await octokit.request(
        "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
        {
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          issue_number: payload.pull_request.number,
          body: messageForPR,
          headers: {
            "x-github-api-version": "2022-11-28",
          },
        }
      );
      console.log("Code Review Posted");
    } catch (error) {
      if (error.response) {
        console.error(
          `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`
        );
      }
      console.error(error);
    }
  } catch (error) {
    if (error.response) {
      console.error(
        `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`
      );
    }
    console.error(error);
  }
}

app.webhooks.on("pull_request.opened", handleGettingCodeDiff);

app.webhooks.onError((error) => {
  if (error.name === "AggregateError") {
    console.error(`Error processing request: ${error.event}`);
  } else {
    console.error(error);
  }
});

const port = 3000;
const host = "localhost";
const path = "/api/webhook";
const localWebhookUrl = `http://${host}:${port}${path}`;

const middleware = createNodeMiddleware(app.webhooks, { path });

http.createServer(middleware).listen(port, () => {
  console.log(`Server is listening for events at: ${localWebhookUrl}`);
  console.log("Press Ctrl + C to quit.");
});
