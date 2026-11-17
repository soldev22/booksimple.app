"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BusinessView, UserView } from "@/server/auth-types";
import {
  AssignmentForm,
  loadData,
  type AdminData,
} from "../admin-panel";
import { submitAccountAction } from "@/app/components/account-form";
import {
  findPotentialDuplicateBusinesses,
  groupPlatformUsers,
} from "./platform-user-groups";

async function loadCompleteDirectory(signal: AbortSignal): Promise<AdminData> {
  const users = new Map<string, UserView>();
  const businesses = new Map<string, BusinessView>();
  const seenStates = new Set<string>();
  let usersCursor: string | undefined;
  let businessesCursor: string | undefined;
  let usersComplete = false;
  let businessesComplete = false;

  while (!usersComplete || !businessesComplete) {
    const state = `${usersComplete}:${usersCursor ?? ""}|${businessesComplete}:${businessesCursor ?? ""}`;
    if (seenStates.has(state)) {
      throw new Error("The server returned a repeated directory page.");
    }
    seenStates.add(state);

    const query = new URLSearchParams();
    if (!usersComplete && usersCursor) query.set("usersCursor", usersCursor);
    if (!businessesComplete && businessesCursor) {
      query.set("businessesCursor", businessesCursor);
    }
    const page = await loadData(query.size ? `?${query}` : "", signal);
    page.users.forEach((user) => users.set(user.id, user));
    page.businesses.forEach((business) => businesses.set(business.id, business));

    if (!usersComplete) {
      usersCursor = page.usersCursor;
      usersComplete = !usersCursor;
    }
    if (!businessesComplete) {
      businessesCursor = page.businessesCursor;
      businessesComplete = !businessesCursor;
    }
  }

  return {
    users: [...users.values()],
    businesses: [...businesses.values()],
  };
}

function roleLabels(user: UserView): string[] {
  const labels: string[] = [];
  if (user.membership) {
    labels.push(
      user.membership.role === "company_admin"
        ? "Company administrator"
        : "Company user",
    );
  }
  if (user.platformAdmin) labels.push("Platform administrator");
  return labels.length ? labels : ["No assigned role"];
}

export function PlatformUsersPanel({
  currentUserId,
  platformAdmin,
}: {
  currentUserId: string;
  platformAdmin: boolean;
}) {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    loadCompleteDirectory(controller.signal)
      .then(setData)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            failure instanceof Error
              ? failure.message
              : "The user directory could not be loaded.",
          );
        }
      });
    return () => controller.abort();
  }, [reloadKey]);

  const visibleUsers = data?.users.filter(
    (user) => user.status !== "deleted" && !user.platformAdmin,
  ) ?? [];
  const groups = data ? groupPlatformUsers(visibleUsers, data.businesses) : [];
  const applications = visibleUsers.filter((user) => user.application);
  const companies = data
    ? [...data.businesses].sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
      )
    : [];

  async function changeUser(
    user: UserView,
    action:
      | "account-status"
      | "delete-user"
      | "assign"
      | "approve"
      | "reject",
    body: Record<string, unknown>,
  ) {
    if (busyUserId) return;
    setBusyUserId(user.id);
    setError("");
    setMessage("");
    try {
      const result = await submitAccountAction(`/api/admin/${action}`, {
        userId: user.id,
        ...body,
      });
      setMessage(result.message ?? "User updated.");
      setData(await loadCompleteDirectory(new AbortController().signal));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The user could not be updated.",
      );
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <>
      <nav aria-label="Platform administration views" className="admin-navigation">
        <Link href={platformAdmin ? "/admin" : "/settings"}>
          {platformAdmin ? "Back to platform administration" : "Back to business settings"}
        </Link>
      </nav>
      <p className="account-notice">
        Pausing blocks sign-in immediately but keeps the account and roles. Deleting
        removes personal account data and access while retaining an audited tombstone.
      </p>
      {message && <p className="account-notice" role="status">{message}</p>}
      {!data && !error && <p role="status">Loading all registered users and companies...</p>}
      {error && (
        <>
          <p className="account-error" role="alert">{error}</p>
          <button
            className="account-button"
            onClick={() => {
              setData(null);
              setError("");
              setReloadKey((value) => value + 1);
            }}
            type="button"
          >
            Retry
          </button>
        </>
      )}
      {data && (
        <p>
          <strong>{visibleUsers.length}</strong> registered user{visibleUsers.length === 1 ? "" : "s"}
          {platformAdmin && (
            <> across <strong>{data.businesses.length}</strong> compan{data.businesses.length === 1 ? "y" : "ies"}</>
          )}.
        </p>
      )}
      {platformAdmin && data && (
        <section className="platform-company-group" id="companies">
          <div className="platform-company-heading">
            <h2>Companies</h2>
            <span>Platform only</span>
          </div>
          {companies.length === 0 ? (
            <p>No companies.</p>
          ) : (
            <div className="platform-user-table-wrap">
              <table className="platform-user-table">
                <caption className="visually-hidden">Companies</caption>
                <thead>
                  <tr>
                    <th scope="col">Company</th>
                    <th scope="col">Status</th>
                    <th scope="col">Members</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((business) => (
                    <tr key={business.id}>
                      <th scope="row">{business.name}</th>
                      <td className="platform-table-status">{business.status}</td>
                      <td>{business.memberCount}</td>
                      <td>{new Date(business.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {platformAdmin && data && (
        <section className="platform-company-group" id="applications">
          <div className="platform-company-heading">
            <h2>Company applications</h2>
            <span>Platform only</span>
          </div>
          {applications.length === 0 ? (
            <p>No company applications.</p>
          ) : (
            <div className="platform-user-table-wrap">
              <table className="platform-user-table">
                <caption className="visually-hidden">Company applications</caption>
                <thead>
                  <tr>
                    <th scope="col">Applicant</th>
                    <th scope="col">Email</th>
                    <th scope="col">Proposed company</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((user) => {
                    const application = user.application!;
                    const duplicates = findPotentialDuplicateBusinesses(
                      application.businessId,
                      application.businessName,
                      data.businesses,
                    );
                    return (
                      <tr key={user.id}>
                        <th scope="row">{user.name}</th>
                        <td>{user.email}</td>
                        <td>
                          <strong>{application.businessName}</strong>
                          {duplicates.length > 0 && (
                            <small className="platform-duplicate-warning">
                              Possible duplicate of {duplicates.map((business) =>
                                `${business.name} (${business.status})`
                              ).join(", ")}
                            </small>
                          )}
                        </td>
                        <td className="platform-table-status">{application.status}</td>
                        <td>
                          <div className="platform-user-actions">
                            {application.status === "pending" && (
                              <>
                                <button
                                  className="account-button"
                                  disabled={Boolean(busyUserId) || !user.emailVerified}
                                  onClick={() => {
                                    if (
                                      duplicates.length === 0 ||
                                      window.confirm(
                                        "A company with the same name already exists. Approve this as a separate company?",
                                      )
                                    ) {
                                      void changeUser(user, "approve", {});
                                    }
                                  }}
                                  type="button"
                                >
                                  Approve as new company
                                </button>
                                <button
                                  className="account-button account-button-secondary"
                                  disabled={Boolean(busyUserId)}
                                  onClick={() => {
                                    if (window.confirm(`Reject ${application.businessName}?`)) {
                                      void changeUser(user, "reject", {});
                                    }
                                  }}
                                  type="button"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {application.status === "approved" && (
                              <button
                                className="account-button account-button-secondary"
                                disabled={Boolean(busyUserId) || !user.emailVerified}
                                onClick={() => void changeUser(user, "approve", {})}
                                type="button"
                              >
                                Retry approval
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {data && (
        <div id="users">
          {groups.map((group) => (
          <details
            className="platform-company-group"
            key={group.key}
            name={platformAdmin ? "company-users" : undefined}
            open={!platformAdmin}
          >
          <summary className="platform-company-heading platform-company-summary">
            <span className="platform-company-name">{group.name}</span>
            <span>{group.status.replaceAll("_", " ")}</span>
          </summary>
          {group.status === "unavailable" && (
            <p className="platform-company-id">Stored company ID: {group.key}</p>
          )}
          {group.users.length === 0 ? (
            <p>No registered users in this group.</p>
          ) : (
            <div className="platform-user-table-wrap">
              <table className="platform-user-table">
                <caption className="visually-hidden">Users in {group.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Roles</th>
                    <th scope="col">Account</th>
                    <th scope="col">Email status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {group.users.map((user) => (
                    <tr key={user.id}>
                      <th scope="row">{user.name || user.email}</th>
                      <td>{user.email}</td>
                      <td>
                        <div className="platform-role-list" aria-label={`Roles for ${user.name || user.email}`}>
                          {roleLabels(user).map((role) => <span key={role}>{role}</span>)}
                        </div>
                      </td>
                      <td className="platform-table-status">{user.status}</td>
                      <td>{user.emailVerified ? "Verified" : "Not verified"}</td>
                      <td>
                        <div className="platform-user-actions">
                          {user.id !== currentUserId && (
                            <details>
                              <summary>Manage role</summary>
                              <AssignmentForm
                                user={user}
                                businesses={data.businesses}
                                busy={Boolean(busyUserId)}
                                lockBusiness={!platformAdmin}
                                assign={(body) => changeUser(user, "assign", body)}
                              />
                            </details>
                          )}
                          {user.id === currentUserId ? (
                            <span>Current account</span>
                          ) : (
                            <>
                            <button
                              className="account-button account-button-secondary"
                              disabled={Boolean(busyUserId)}
                              onClick={() => {
                                const pausing = user.status !== "disabled";
                                if (
                                  window.confirm(
                                    `${pausing ? "Pause" : "Resume"} ${user.email}?`,
                                  )
                                ) {
                                  void changeUser(user, "account-status", {
                                    paused: pausing,
                                  });
                                }
                              }}
                              type="button"
                            >
                              {user.status === "disabled" ? "Resume" : "Pause"}
                            </button>
                            <button
                              className="account-button account-button-danger"
                              disabled={Boolean(busyUserId)}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Delete ${user.email}? Their personal account data and access will be removed. This cannot be undone.`,
                                  )
                                ) {
                                  void changeUser(user, "delete-user", {});
                                }
                              }}
                              type="button"
                            >
                              Delete
                            </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </details>
          ))}
        </div>
      )}
    </>
  );
}
