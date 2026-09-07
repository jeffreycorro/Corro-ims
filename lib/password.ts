export const MIN_PASSWORD_LENGTH = 8;

export type PasswordChangeInput = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export function validatePasswordChange(input: PasswordChangeInput): string | null {
  const currentPassword = input.currentPassword;
  const newPassword = input.newPassword;
  const confirmPassword = input.confirmPassword;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return "Enter your current password and a new password.";
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (newPassword !== confirmPassword) {
    return "New password and confirmation do not match.";
  }

  if (newPassword === currentPassword) {
    return "New password must be different from the current password.";
  }

  return null;
}
