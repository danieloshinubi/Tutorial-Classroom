import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSchool } from "../../context/SchoolContext";
import { fetchSchoolMembers } from "../../lib/api";
import { buildOrgTree } from "../../lib/orgChart";
import { ROLE_LABEL, toneFor } from "../../lib/roles";
import PersonModal from "../../Components/PersonModal";
import { Card, Badge, Empty, SkeletonText, displayName, initials, bandClass } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";

// One node's card, plus (recursively) the connector lines and cards for
// everyone who reports to them. Built as nested <ul>/<li> rather than a
// grid — the standard pure-CSS org-chart technique, where the tree's own
// nesting draws itself via ::before/::after border lines (see
// theme.css's .org-tree rules) instead of anything computing pixel
// positions.
const OrgNode = ({ node, onSelect }) => (
  <li>
    <button type="button" className="org-node" onClick={() => onSelect(node)}>
      {node.profiles?.avatar_url ? (
        <img src={node.profiles.avatar_url} alt="" className="org-node-avatar org-node-avatar-photo" />
      ) : (
        <span className={`org-node-avatar ${bandClass(node.profiles?.id || displayName(node.profiles))}`}>
          {initials(node.profiles)}
        </span>
      )}
      <span className="org-node-text">
        <span className="org-node-name">{displayName(node.profiles)}</span>
        <Badge tone={toneFor(node.role)}>{ROLE_LABEL[node.role]}</Badge>
      </span>
    </button>
    {node.children.length > 0 ? (
      <ul>
        {node.children.map((child) => (
          <OrgNode key={child.id} node={child} onSelect={onSelect} />
        ))}
      </ul>
    ) : null}
  </li>
);

const OrganogramPanel = () => {
  const { schoolId } = useSchool();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const { setError } = useActionFeedback();

  const load = useCallback(() => {
    if (!schoolId) return;
    setLoading(true);
    fetchSchoolMembers(schoolId)
      .then(setMembers)
      .catch((err) => setError(err.message || "Could not load the org chart."))
      .finally(() => setLoading(false));
  }, [schoolId, setError]);

  useEffect(load, [load]);

  const roots = useMemo(() => buildOrgTree(members), [members]);

  return (
    <>
      <div className="panel-top">
        <div className="page-head">
          <p style={{ color: "var(--ink-3)", fontSize: 14, margin: 0 }}>
            {"Who reports to whom, built from each person's “Reports to” on the People tab. Click anyone for details."}
          </p>
        </div>
      </div>

      {loading ? <SkeletonText lines={6} /> : null}

      {!loading && roots.length === 0 ? (
        <Empty>{"Nobody has a reporting line set yet — set “Reports to” for staff on the People tab."}</Empty>
      ) : null}

      {!loading && roots.length > 0 ? (
        <Card className="pad-0">
          <div className="org-chart-wrap">
            {roots.map((root) => (
              <ul className="org-tree" key={root.id}>
                <OrgNode node={root} onSelect={setSelected} />
              </ul>
            ))}
          </div>
        </Card>
      ) : null}

      {selected ? (
        <PersonModal person={selected} schoolMembers={members} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
};

export default OrganogramPanel;
