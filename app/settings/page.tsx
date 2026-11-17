import { DeleteAccount } from "@/components/settings/delete-account";
import { ProfileForm } from "@/components/settings/profile-form";
import { messages } from "@/lib/messages";
import { getAccount } from "@/server/account";
import { requireUser } from "@/server/require-user";

export const metadata = { title: messages.settings.title };

export default async function SettingsPage() {
  const t = messages.settings;
  const user = await requireUser("/settings");
  const account = await getAccount(user.id);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 py-10">
      <h1 className="text-2xl font-bold">{t.title}</h1>
      <section aria-labelledby="settings-profile-heading" className="flex flex-col gap-4">
        <h2 id="settings-profile-heading" className="text-lg font-semibold">
          {t.profileHeading}
        </h2>
        <ProfileForm name={account.name ?? ""} email={account.email} />
      </section>
      <section
        aria-labelledby="settings-delete-heading"
        className="flex flex-col gap-4 rounded-lg border border-destructive p-5"
      >
        <h2 id="settings-delete-heading" className="text-lg font-semibold text-destructive">
          {t.deleteHeading}
        </h2>
        <DeleteAccount email={account.email} />
      </section>
    </main>
  );
}
