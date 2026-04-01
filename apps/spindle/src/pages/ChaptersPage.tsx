// Chapters page — add, edit, and manage chapter points for titles.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useState } from 'react';
import { useProjectStore } from '../store/project-store';
import type { ChapterPoint, SpindleProjectFile } from '../types/project';
import './ChaptersPage.css';

export function ChaptersPage() {
	const project = useProjectStore((s) => s.project);
	const updateProject = useProjectStore((s) => s.updateProject);
	const [selectedTitleId, setSelectedTitleId] = useState<string | null>(null);

	if (!project) return null;

	const allTitles = project.disc.titlesets.flatMap((ts) => ts.titles);
	const selectedTitle = allTitles.find((t) => t.id === selectedTitleId) ?? null;
	const asset = selectedTitle
		? (project.assets.find((a) => a.id === selectedTitle.sourceAssetId) ?? null)
		: null;

	const handleUpdateChapters = (titleId: string, chapters: ChapterPoint[]) => {
		updateProject((p) => updateChaptersInProject(p, titleId, chapters));
	};

	const handleAddChapter = () => {
		if (!selectedTitle) return;
		const chapters = selectedTitle.chapters;
		const lastTime = chapters.length > 0 ? chapters[chapters.length - 1].timestampSecs + 60 : 0;
		const newChapter: ChapterPoint = {
			id: crypto.randomUUID(),
			name: `Chapter ${chapters.length + 1}`,
			timestampSecs: lastTime,
			orderIndex: chapters.length,
		};
		handleUpdateChapters(selectedTitle.id, [...chapters, newChapter]);
	};

	const canSeedFromSource = selectedTitle != null && (asset?.sourceChapters?.length ?? 0) > 0;

	const handleSeedFromSource = () => {
		if (!selectedTitle || !asset?.sourceChapters?.length) return;
		if (
			selectedTitle.chapters.length > 0 &&
			!window.confirm('Replace all existing chapters with chapters from the source asset?')
		)
			return;
		const chapters: ChapterPoint[] = asset.sourceChapters.map((ch, i) => ({
			id: crypto.randomUUID(),
			name: ch.title ?? `Chapter ${i + 1}`,
			timestampSecs: ch.startSecs,
			orderIndex: i,
		}));
		handleUpdateChapters(selectedTitle.id, chapters);
	};

	const handleRemoveChapter = (chapterId: string) => {
		if (!selectedTitle) return;
		const chapters = selectedTitle.chapters
			.filter((c) => c.id !== chapterId)
			.map((c, i) => ({ ...c, orderIndex: i }));
		handleUpdateChapters(selectedTitle.id, chapters);
	};

	const handleUpdateChapter = (updated: ChapterPoint) => {
		if (!selectedTitle) return;
		const chapters = selectedTitle.chapters
			.map((c) => (c.id === updated.id ? updated : c))
			.sort((a, b) => a.timestampSecs - b.timestampSecs)
			.map((c, i) => ({ ...c, orderIndex: i }));
		handleUpdateChapters(selectedTitle.id, chapters);
	};

	return (
		<div className="chapters">
			<div className="page-header">
				<h1 className="page-title">Chapters</h1>
				{selectedTitle && (
					<>
						<button className="btn btn--primary" onClick={handleAddChapter}>
							Add Chapter
						</button>
						{canSeedFromSource && (
							<button className="btn btn--secondary" onClick={handleSeedFromSource}>
								Seed from Source
							</button>
						)}
					</>
				)}
			</div>

			{allTitles.length === 0 ? (
				<div className="chapters__empty">
					<h2>No titles available</h2>
					<p className="text-muted">
						Create titles in the Titles page first, then come back here to add chapters.
					</p>
				</div>
			) : (
				<div className="chapters__layout">
					<div className="chapters__title-list">
						<h3 className="chapters__section-heading">Select Title</h3>
						{allTitles.map((title) => (
							<div
								key={title.id}
								className={`chapters__title-item card ${title.id === selectedTitleId ? 'chapters__title-item--selected' : ''}`}
								onClick={() => setSelectedTitleId(title.id)}
								role="button"
								tabIndex={0}
								onKeyDown={(e) => e.key === 'Enter' && setSelectedTitleId(title.id)}
							>
								<span className="chapters__title-name">{title.name}</span>
								<span className="badge badge--neutral">{title.chapters.length} ch</span>
							</div>
						))}
					</div>

					<div className="chapters__editor">
						{!selectedTitle ? (
							<div className="chapters__select-prompt text-muted">
								Select a title to manage its chapters.
							</div>
						) : selectedTitle.chapters.length === 0 ? (
							<div className="chapters__no-chapters">
								<p className="text-muted">No chapters for "{selectedTitle.name}" yet.</p>
								<button className="btn btn--primary" onClick={handleAddChapter}>
									Add First Chapter
								</button>
							</div>
						) : (
							<>
								{/* Timeline visualisation */}
								{asset?.durationSecs && (
									<div className="chapters__timeline">
										<div className="chapters__timeline-bar">
											{selectedTitle.chapters.map((ch) => {
												const pct = (ch.timestampSecs / asset.durationSecs!) * 100;
												return (
													<div
														key={ch.id}
														className="chapters__timeline-mark"
														style={{ left: `${Math.min(pct, 100)}%` }}
														title={`${ch.name} — ${formatTimestamp(ch.timestampSecs)}`}
													/>
												);
											})}
										</div>
										<div className="chapters__timeline-labels">
											<span>0:00</span>
											<span>{formatTimestamp(asset.durationSecs)}</span>
										</div>
									</div>
								)}

								{/* Chapter list */}
								<div className="chapters__list">
									{selectedTitle.chapters.map((ch, idx) => (
										<div key={ch.id} className="chapters__row">
											<span className="chapters__row-index">{idx + 1}</span>
											<input
												className="chapters__row-name"
												value={ch.name}
												onChange={(e) => handleUpdateChapter({ ...ch, name: e.target.value })}
											/>
											<input
												className="chapters__row-time"
												value={formatTimestamp(ch.timestampSecs)}
												onChange={(e) => {
													const secs = parseTimestamp(e.target.value);
													if (secs !== null) {
														handleUpdateChapter({ ...ch, timestampSecs: secs });
													}
												}}
												placeholder="0:00:00"
											/>
											<button
												className="chapters__row-remove"
												onClick={() => handleRemoveChapter(ch.id)}
												title="Remove chapter"
											>
												×
											</button>
										</div>
									))}
								</div>
							</>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function updateChaptersInProject(
	project: SpindleProjectFile,
	titleId: string,
	chapters: ChapterPoint[],
): SpindleProjectFile {
	return {
		...project,
		disc: {
			...project.disc,
			titlesets: project.disc.titlesets.map((ts) => ({
				...ts,
				titles: ts.titles.map((t) => (t.id === titleId ? { ...t, chapters } : t)),
			})),
		},
	};
}

function formatTimestamp(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parseTimestamp(str: string): number | null {
	const parts = str.split(':').map(Number);
	if (parts.some(isNaN)) return null;
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	if (parts.length === 1) return parts[0];
	return null;
}
