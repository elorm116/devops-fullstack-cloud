export default function PostList({ posts }) {
  if (!posts.length) {
    return <p className="empty-state">No posts yet. Be the first to write something!</p>;
  }

  return (
    <div className="post-list">
      {posts.map((post) => (
        <article className="post-card" key={post._id}>
          <h2 className="post-title">{post.title}</h2>
          <div className="post-meta">
            <span>{post.author || 'Anonymous'}</span>
            <span>&middot;</span>
            <span>{new Date(post.createdAt).toLocaleDateString('en-US', {
              year: 'numeric', month: 'long', day: 'numeric'
            })}</span>
          </div>
          <p className="post-content">{post.content}</p>
        </article>
      ))}
    </div>
  );
}
