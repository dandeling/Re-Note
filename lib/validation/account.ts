import { z } from "zod";

export const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(50),
});

/** 계정 삭제 확인: 로그인 이메일을 다시 입력해야 한다. */
export const deleteAccountSchema = z.object({
  confirmEmail: z.string().trim().min(1).max(320),
});

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
