import { CODE_REVIEW_PROMPT_TEMPLATE } from "../constants.js";

export function getCodeReviewPrompt(codeDiff) {
  return CODE_REVIEW_PROMPT_TEMPLATE.replace("${codeDiff}", codeDiff);
}
